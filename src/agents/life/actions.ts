/**
 * v2 Life Agent 인터랙티브 버튼 핸들러.
 * SQL 기반 — Notion 의존성 없음.
 */

import type { App } from '@slack/bolt';
import {
  completeRecord,
  queryTodayRecords,
  queryTodaySchedules,
  queryBacklogSchedules,
  updateScheduleStatus,
  postponeSchedule,
  deleteSchedule,
  toggleScheduleImportant,
  moveScheduleToDate,
} from '../../shared/life-queries.js';
import { updateMessage } from '../../shared/slack.js';
import { queryWithRowLimit } from '../../shared/db.js';
import {
  findActivePending,
  markExecuted,
  markCanceled,
} from '../../shared/pending-modify.js';
import { getTodayISO, addDays } from '../../shared/kst.js';
import { resolveUserId, DEFAULT_USER_ID } from '../../shared/user-resolver.js';
import {
  ROUTINE_ACTION_ID,
  SCHEDULE_ACTION_ID,
  POSTPONE_ACTION,
  DELETE_ACTION,
  TOGGLE_IMPORTANT_ACTION,
  MOVE_TO_TODAY_ACTION,
  CONFIRM_MODIFY_EXECUTE_ACTION_ID,
  CONFIRM_MODIFY_CANCEL_ACTION_ID,
  parseButtonValue,
  parseOverflowValue,
  buildRoutineBlocks,
  buildFilteredRoutineBlocks,
  buildScheduleBlocks,
} from './blocks.js';
import { publishHomeView } from './home.js';

const CONFIRM_EXECUTE_TIMEOUT_MS = 10_000;
const CONFIRM_EXECUTE_MAX_ROWS = 50;

/** Slack body에서 userId 해석 (미등록이면 DEFAULT_USER_ID 폴백) */
const resolveBodyUserId = async (body: { user?: string | { id: string } }): Promise<number> => {
  const slackUserId = body.user
    ? (typeof body.user === 'string' ? body.user : body.user.id)
    : '';
  if (!slackUserId) return DEFAULT_USER_ID;
  return (await resolveUserId(slackUserId)) ?? DEFAULT_USER_ID;
};

/** v2 Life Agent 액션 핸들러 등록 */
export const registerLifeActions = (app: App): void => {
  // ── 루틴 완료 버튼 ──
  app.action(ROUTINE_ACTION_ID, async ({ ack, body, client }) => {
    await ack();

    const action = 'actions' in body ? body.actions[0] : undefined;
    if (!action || !('value' in action)) return;

    const rawValue = action.value;
    if (!rawValue) return;

    const { recordId, date, filter } = parseButtonValue(rawValue);

    try {
      const userId = await resolveBodyUserId(body);
      await completeRecord(recordId, userId);

      // 버튼에 인코딩된 날짜 사용 (자정 이후 클릭 시에도 원래 날짜 기준 조회)
      const today = date ?? getTodayISO();
      const records = await queryTodayRecords(today, userId);

      const { text, blocks } = filter
        ? buildFilteredRoutineBlocks(records, today, filter.targetSlots, filter.incompleteFrom)
        : buildRoutineBlocks(records, today);

      const channelId =
        'channel' in body && body.channel ? body.channel.id : undefined;
      const messageTs =
        'message' in body && body.message ? body.message.ts : undefined;

      if (channelId && messageTs) {
        await updateMessage(client, channelId, messageTs, text, blocks);
      }

      // Home 탭 갱신
      const slackUserId = 'user' in body && body.user
        ? (typeof body.user === 'string' ? body.user : body.user.id)
        : undefined;
      if (slackUserId) {
        await publishHomeView(client, slackUserId).catch(() => {});
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[Life Action] 루틴 완료 처리 오류: ${msg}`);
    }
  });

  // ── 일정 상태 변경 overflow ──
  app.action(SCHEDULE_ACTION_ID, async ({ ack, body, client }) => {
    await ack();

    const action = 'actions' in body ? body.actions[0] : undefined;
    if (!action || !('selected_option' in action)) return;

    const selected = action as { selected_option?: { value?: string } };
    const rawValue = selected.selected_option?.value;
    if (!rawValue) return;

    const { scheduleId, newStatus, targetDate } = parseOverflowValue(rawValue);

    try {
      const userId = await resolveBodyUserId(body);

      if (newStatus === DELETE_ACTION) {
        await deleteSchedule(scheduleId, userId);
      } else if (newStatus === TOGGLE_IMPORTANT_ACTION) {
        await toggleScheduleImportant(scheduleId, userId);
      } else if (newStatus === POSTPONE_ACTION) {
        const tomorrow = addDays(targetDate, 1);
        await postponeSchedule(scheduleId, tomorrow, userId);
      } else if (newStatus === MOVE_TO_TODAY_ACTION) {
        await moveScheduleToDate(scheduleId, getTodayISO(), userId);
      } else {
        await updateScheduleStatus(scheduleId, newStatus, userId);
      }

      const isBacklog = targetDate === 'backlog';
      const items = isBacklog
        ? await queryBacklogSchedules(userId)
        : await queryTodaySchedules(targetDate, userId);
      const { text, blocks } = isBacklog
        ? buildScheduleBlocks(items, 'backlog', undefined, { backlog: true })
        : buildScheduleBlocks(items, targetDate);

      const channelId =
        'channel' in body && body.channel ? body.channel.id : undefined;
      const messageTs =
        'message' in body && body.message ? body.message.ts : undefined;

      if (channelId && messageTs) {
        await updateMessage(client, channelId, messageTs, text, blocks);
      }

      // Home 탭 갱신
      const slackUserId = 'user' in body && body.user
        ? (typeof body.user === 'string' ? body.user : body.user.id)
        : undefined;
      if (slackUserId) {
        await publishHomeView(client, slackUserId).catch(() => {});
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[Life Action] 일정 상태 변경 오류: ${msg}`);
    }
  });

  // ── modify_db 확인 플로우: 실행 ──
  app.action(CONFIRM_MODIFY_EXECUTE_ACTION_ID, async ({ ack, body, client }) => {
    await ack();

    const action = 'actions' in body ? body.actions[0] : undefined;
    if (!action || !('value' in action)) return;
    const token = action.value;
    if (!token) return;

    const userId = await resolveBodyUserId(body);
    const pending = await findActivePending(token, userId);

    const channelId =
      'channel' in body && body.channel ? body.channel.id : undefined;
    const messageTs =
      'message' in body && body.message ? body.message.ts : undefined;

    if (!pending) {
      if (channelId && messageTs) {
        await updateMessage(
          client,
          channelId,
          messageTs,
          '이 요청은 만료됐거나 이미 처리됐어. 다시 요청해줘.',
          [],
        );
      }
      return;
    }

    try {
      const result = await queryWithRowLimit(
        pending.sql_text,
        CONFIRM_EXECUTE_TIMEOUT_MS,
        CONFIRM_EXECUTE_MAX_ROWS,
      );
      await markExecuted(pending.id);
      if (channelId && messageTs) {
        await updateMessage(
          client,
          channelId,
          messageTs,
          `실행 완료. ${result.rowCount ?? 0}개 행 변경됐어.`,
          [],
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Life Action] modify_db 실행 오류: ${msg}`);
      if (channelId && messageTs) {
        await updateMessage(client, channelId, messageTs, `실행 실패: ${msg}`, []);
      }
    }
  });

  // ── modify_db 확인 플로우: 취소 ──
  app.action(CONFIRM_MODIFY_CANCEL_ACTION_ID, async ({ ack, body, client }) => {
    await ack();

    const action = 'actions' in body ? body.actions[0] : undefined;
    if (!action || !('value' in action)) return;
    const token = action.value;
    if (!token) return;

    const userId = await resolveBodyUserId(body);
    const pending = await findActivePending(token, userId);
    if (pending) await markCanceled(pending.id);

    const channelId =
      'channel' in body && body.channel ? body.channel.id : undefined;
    const messageTs =
      'message' in body && body.message ? body.message.ts : undefined;

    if (channelId && messageTs) {
      await updateMessage(
        client,
        channelId,
        messageTs,
        '취소했어. 아무것도 바뀌지 않았어.',
        [],
      );
    }
  });
};
