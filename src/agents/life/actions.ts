/**
 * v2 Life Agent 인터랙티브 버튼 핸들러.
 * SQL 기반 — Notion 의존성 없음.
 */

import type { App } from '@slack/bolt';
import {
  completeRecord,
  queryTodayRecords,
  queryTodaySchedules,
  updateScheduleStatus,
  postponeSchedule,
} from '../../shared/life-queries.js';
import { updateMessage } from '../../shared/slack.js';
import {
  ROUTINE_ACTION_ID,
  SCHEDULE_ACTION_ID,
  POSTPONE_ACTION,
  parseButtonValue,
  parseOverflowValue,
  buildRoutineBlocks,
  buildFilteredRoutineBlocks,
  buildScheduleBlocks,
} from './blocks.js';
import { getTodayISO } from './prompt.js';

/** 날짜를 N일 이동 (YYYY-MM-DD) */
const addDays = (dateStr: string, days: number): string => {
  const d = new Date(dateStr + 'T00:00:00+09:00');
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
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

    const { recordId, filter } = parseButtonValue(rawValue);

    try {
      await completeRecord(recordId);

      const today = getTodayISO();
      const records = await queryTodayRecords(today);

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
      if (newStatus === POSTPONE_ACTION) {
        const tomorrow = addDays(targetDate, 1);
        await postponeSchedule(scheduleId, tomorrow);
      } else {
        await updateScheduleStatus(scheduleId, newStatus);
      }

      const items = await queryTodaySchedules(targetDate);
      const { text, blocks } = buildScheduleBlocks(items, targetDate);

      const channelId =
        'channel' in body && body.channel ? body.channel.id : undefined;
      const messageTs =
        'message' in body && body.message ? body.message.ts : undefined;

      if (channelId && messageTs) {
        await updateMessage(client, channelId, messageTs, text, blocks);
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[Life Action] 일정 상태 변경 오류: ${msg}`);
    }
  });
};
