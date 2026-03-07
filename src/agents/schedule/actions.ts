import type { App } from '@slack/bolt';
import type { Client as NotionClient } from '@notionhq/client';
import { updatePageProperties, queryTodaySchedules } from '../../shared/notion.js';
import { updateMessage } from '../../shared/slack.js';
import { ACTION_ID, parseOverflowValue, buildScheduleBlocks } from './blocks.js';

/** 일정 overflow 메뉴 액션 핸들러 등록 */
export const registerScheduleActions = (
  app: App,
  notionClient: NotionClient,
  dbId: string,
): void => {
  app.action(ACTION_ID, async ({ ack, body, client }) => {
    await ack();

    const action = 'actions' in body ? body.actions[0] : undefined;
    // overflow: selected_option.value (button의 action.value와 다름!)
    if (!action || !('selected_option' in action)) return;

    const selected = action as { selected_option?: { value?: string } };
    const rawValue = selected.selected_option?.value;
    if (!rawValue) return;

    const { pageId, newStatus, targetDate } = parseOverflowValue(rawValue);

    try {
      // 1. Notion 상태 업데이트
      await updatePageProperties(notionClient, pageId, {
        '상태': { select: { name: newStatus } },
      });

      // 2. 해당 날짜 일정 재조회
      const items = await queryTodaySchedules(notionClient, dbId, targetDate);

      // 3. 블록 재빌드 + 메시지 인플레이스 업데이트
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
      console.error(`[Schedule Action] 상태 변경 오류: ${msg}`);
    }
  });
};
