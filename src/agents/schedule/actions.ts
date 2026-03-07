import type { App } from '@slack/bolt';
import type { Client as NotionClient } from '@notionhq/client';
import { updatePageProperties, queryTodaySchedules } from '../../shared/notion.js';
import { updateMessage } from '../../shared/slack.js';
import { ACTION_ID, POSTPONE_ACTION, parseOverflowValue, buildScheduleBlocks } from './blocks.js';

/** 날짜를 N일 이동 (YYYY-MM-DD) */
const addDays = (dateStr: string, days: number): string => {
  const d = new Date(dateStr + 'T00:00:00+09:00');
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

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
      if (newStatus === POSTPONE_ACTION) {
        // 내일로 미루기: Date를 내일로 변경 + 상태를 todo로 리셋
        const tomorrow = addDays(targetDate, 1);
        await updatePageProperties(notionClient, pageId, {
          'Date': { date: { start: tomorrow } },
          '상태': { select: { name: 'todo' } },
        });
      } else {
        // 일반 상태 변경
        await updatePageProperties(notionClient, pageId, {
          '상태': { select: { name: newStatus } },
        });
      }

      // 해당 날짜 일정 재조회 → 블록 재빌드 + 인플레이스 업데이트
      const items = await queryTodaySchedules(notionClient, dbId, targetDate);
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
