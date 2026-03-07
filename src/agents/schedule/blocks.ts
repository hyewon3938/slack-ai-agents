import type { KnownBlock } from '@slack/types';
import type { ScheduleItem } from '../../shared/notion.js';
import { sortItems, formatItem, formatDateShort } from '../../cron/schedule-reminder.js';

export const ACTION_ID = 'schedule_status';

// --- value 인코딩/파싱 ---

/** overflow value 형식: "{pageId}|{newStatus}|{targetDate}" */
export const encodeOverflowValue = (
  pageId: string,
  newStatus: string,
  targetDate: string,
): string => `${pageId}|${newStatus}|${targetDate}`;

export const parseOverflowValue = (
  value: string,
): { pageId: string; newStatus: string; targetDate: string } => {
  const parts = value.split('|');
  return {
    pageId: parts[0]!,
    newStatus: parts[1]!,
    targetDate: parts[2]!,
  };
};

// --- overflow 옵션 ---

const STATUS_OPTIONS: { status: string; label: string }[] = [
  { status: 'done', label: '완료' },
  { status: 'in-progress', label: '진행중' },
  { status: 'todo', label: '할일' },
];

/** 현재 상태가 아닌 나머지 상태를 overflow 옵션으로 제공 */
const buildOverflowOptions = (
  item: ScheduleItem,
  targetDate: string,
): Array<{ text: { type: 'plain_text'; text: string }; value: string }> => {
  const currentStatus = item.status ?? 'todo';
  return STATUS_OPTIONS
    .filter((opt) => opt.status !== currentStatus)
    .map((opt) => ({
      text: { type: 'plain_text' as const, text: opt.label },
      value: encodeOverflowValue(item.id, opt.status, targetDate),
    }));
};

// --- 블록 빌드 ---

/** 일정 목록을 Block Kit으로 빌드 (overflow 메뉴 포함) */
export const buildScheduleBlocks = (
  items: ScheduleItem[],
  targetDate: string,
  headerText?: string,
): { text: string; blocks: KnownBlock[] } => {
  const blocks: KnownBlock[] = [];
  const formatted = formatDateShort(targetDate);

  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: headerText ?? `${formatted} 일정` },
  });

  const sorted = sortItems(items);

  for (const item of sorted) {
    const isAppointment = item.category.includes('약속');
    const itemText = formatItem(item);

    if (isAppointment || !item.status) {
      // 약속: overflow 없이 텍스트만
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: itemText },
      });
    } else {
      // 할일/진행중/완료: overflow 메뉴 추가
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: itemText },
        accessory: {
          type: 'overflow',
          action_id: ACTION_ID,
          options: buildOverflowOptions(item, targetDate),
        },
      });
    }
  }

  // 하단 통계
  const total = items.length;
  const done = items.filter((i) => i.status === 'done').length;
  const appointments = items.filter((i) => i.category.includes('약속')).length;

  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'context',
    elements: [
      { type: 'mrkdwn', text: `전체 ${total}개 · 완료 ${done}개 · 약속 ${appointments}개` },
    ],
  });

  const fallbackText = `${formatted} 일정 (${total}개)`;
  return { text: fallbackText, blocks };
};
