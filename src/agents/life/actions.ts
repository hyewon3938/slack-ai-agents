/**
 * v2 Life Agent 인터랙티브 버튼 핸들러.
 * SQL 기반 — Notion 의존성 없음.
 */

import type { App } from '@slack/bolt';
import { completeRecord, queryTodayRecords } from '../../shared/life/queries-routine.js';
import {
  queryTodaySchedules,
  queryBacklogSchedules,
  updateScheduleStatus,
  postponeSchedule,
  deleteSchedule,
  toggleScheduleImportant,
  moveScheduleToDate,
} from '../../shared/life/queries-schedule.js';
import { updateMessage } from '../../shared/slack.js';
import { getTodayISO, addDays } from '../../shared/kst.js';
import {
  ROUTINE_ACTION_ID,
  SCHEDULE_ACTION_ID,
  POSTPONE_ACTION,
  DELETE_ACTION,
  TOGGLE_IMPORTANT_ACTION,
  MOVE_TO_TODAY_ACTION,
  CONFIRM_MODIFY_EXECUTE_ACTION_ID,
  CONFIRM_MODIFY_CANCEL_ACTION_ID,
} from './blocks/constants.js';
import {
  parseButtonValue,
  buildRoutineBlocks,
  buildFilteredRoutineBlocks,
} from './blocks/routine.js';
import { parseOverflowValue } from './blocks/schedule-overflow.js';
import { buildScheduleBlocks } from './blocks/schedule.js';
import { publishHomeView } from './home.js';
import { resolveBodyUserId, type ActionArgs } from './action-shared.js';
import { handleConfirmModifyExecute, handleConfirmModifyCancel } from './confirm-modify-actions.js';

/** 루틴 완료 버튼 */
const handleRoutineComplete = async ({ ack, body, client }: ActionArgs): Promise<void> => {
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

    const channelId = 'channel' in body && body.channel ? body.channel.id : undefined;
    const messageTs = 'message' in body && body.message ? body.message.ts : undefined;

    if (channelId && messageTs) {
      await updateMessage(client, channelId, messageTs, text, blocks);
    }

    // Home 탭 갱신
    const slackUserId =
      'user' in body && body.user
        ? typeof body.user === 'string'
          ? body.user
          : body.user.id
        : undefined;
    if (slackUserId) {
      await publishHomeView(client, slackUserId).catch(() => {});
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[Life Action] 루틴 완료 처리 오류: ${msg}`);
  }
};

/** 일정 상태 변경 overflow */
const handleScheduleStatusChange = async ({ ack, body, client }: ActionArgs): Promise<void> => {
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

    const channelId = 'channel' in body && body.channel ? body.channel.id : undefined;
    const messageTs = 'message' in body && body.message ? body.message.ts : undefined;

    if (channelId && messageTs) {
      await updateMessage(client, channelId, messageTs, text, blocks);
    }

    // Home 탭 갱신
    const slackUserId =
      'user' in body && body.user
        ? typeof body.user === 'string'
          ? body.user
          : body.user.id
        : undefined;
    if (slackUserId) {
      await publishHomeView(client, slackUserId).catch(() => {});
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[Life Action] 일정 상태 변경 오류: ${msg}`);
  }
};

/** v2 Life Agent 액션 핸들러 등록 */
export const registerLifeActions = (app: App): void => {
  app.action(ROUTINE_ACTION_ID, handleRoutineComplete);
  app.action(SCHEDULE_ACTION_ID, handleScheduleStatusChange);
  app.action(CONFIRM_MODIFY_EXECUTE_ACTION_ID, handleConfirmModifyExecute);
  app.action(CONFIRM_MODIFY_CANCEL_ACTION_ID, handleConfirmModifyCancel);
};
