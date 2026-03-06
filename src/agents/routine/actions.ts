import type { App } from '@slack/bolt';
import type { Client as NotionClient } from '@notionhq/client';
import {
  completeRoutineRecord,
  queryTodayRoutineRecords,
} from '../../shared/routine-notion.js';
import { updateMessage } from '../../shared/slack.js';
import { buildRoutineBlocks } from './blocks.js';

const ACTION_ID = 'routine_complete';

/** KST(UTC+9) 기준 오늘 날짜 (YYYY-MM-DD) */
const getTodayISO = (): string => {
  const now = new Date();
  const kst = new Date(now.getTime() + (now.getTimezoneOffset() + 540) * 60_000);
  const yyyy = kst.getFullYear();
  const mm = String(kst.getMonth() + 1).padStart(2, '0');
  const dd = String(kst.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

/** 루틴 완료 버튼 액션 핸들러 등록 */
export const registerRoutineActions = (
  app: App,
  notionClient: NotionClient,
  dbId: string,
): void => {
  app.action(ACTION_ID, async ({ ack, body, client }) => {
    await ack();

    const action = 'actions' in body ? body.actions[0] : undefined;
    if (!action || !('value' in action)) return;

    const pageId = action.value;
    if (!pageId) return;

    try {
      await completeRoutineRecord(notionClient, pageId);

      const today = getTodayISO();
      const records = await queryTodayRoutineRecords(notionClient, dbId, today);
      const { text, blocks } = buildRoutineBlocks(records, today);

      const channelId =
        'channel' in body && body.channel ? body.channel.id : undefined;
      const messageTs =
        'message' in body && body.message ? body.message.ts : undefined;

      if (channelId && messageTs) {
        await updateMessage(client, channelId, messageTs, text, blocks);
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[Routine Action] 완료 처리 오류: ${msg}`);
    }
  });
};
