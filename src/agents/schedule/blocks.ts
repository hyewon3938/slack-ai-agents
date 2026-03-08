import type { KnownBlock } from '@slack/types';
import type { ScheduleItem } from '../../shared/notion.js';
import { groupItemsByCategory, formatItem, formatDateShort } from '../../cron/schedule-reminder.js';

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

/** 미루기 특수 액션 값 */
export const POSTPONE_ACTION = 'postpone';

/** 현재 상태가 아닌 나머지 상태 + 미루기를 overflow 옵션으로 제공 */
const buildOverflowOptions = (
  item: ScheduleItem,
  targetDate: string,
): Array<{ text: { type: 'plain_text'; text: string }; value: string }> => {
  const currentStatus = item.status ?? 'todo';
  const options = STATUS_OPTIONS
    .filter((opt) => opt.status !== currentStatus)
    .map((opt) => ({
      text: { type: 'plain_text' as const, text: opt.label },
      value: encodeOverflowValue(item.id, opt.status, targetDate),
    }));

  // 완료가 아닌 항목에만 "내일로 미루기" 추가
  if (currentStatus !== 'done') {
    options.push({
      text: { type: 'plain_text' as const, text: '내일로 미루기' },
      value: encodeOverflowValue(item.id, POSTPONE_ACTION, targetDate),
    });
  }

  return options;
};

// --- 블록 빌드 ---

/** 일정 목록을 Block Kit으로 빌드 (카테고리별 그룹핑 + overflow 메뉴) */
export const buildScheduleBlocks = (
  items: ScheduleItem[],
  targetDate: string,
  categoryOrder: string[],
  headerText?: string,
): { text: string; blocks: KnownBlock[] } => {
  const blocks: KnownBlock[] = [];
  const formatted = formatDateShort(targetDate);

  // 헤더 — section mrkdwn 볼드 (header 블록보다 컴팩트)
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: `*${headerText ?? `${formatted} 일정`}*` },
  });

  const groups = groupItemsByCategory(items, categoryOrder);

  for (const group of groups) {
    // 카테고리 서브 헤더
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*[${group.category}]*` },
    });

    // overflow 없는 항목(약속)은 한 블록에 모아서 표시
    // overflow 있는 항목은 개별 section (accessory 필요)
    const noOverflowLines: string[] = [];

    const flushNoOverflow = (): void => {
      if (noOverflowLines.length === 0) return;
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: noOverflowLines.join('\n') },
      });
      noOverflowLines.length = 0;
    };

    for (const item of group.items) {
      const isAppointment = item.category.includes('약속');
      const itemText = formatItem(item);

      if (isAppointment || !item.status) {
        noOverflowLines.push(itemText);
      } else {
        flushNoOverflow();
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

    flushNoOverflow();
  }

  // 하단 통계 — 약속 제외, 할일만 카운트
  const tasks = items.filter((i) => !i.category.includes('약속'));
  const done = tasks.filter((i) => i.status === 'done').length;

  blocks.push({
    type: 'context',
    elements: [
      { type: 'mrkdwn', text: `${done}/${tasks.length} 완료` },
    ],
  });

  const fallbackText = `${formatted} 일정 (${items.length}개)`;
  return { text: fallbackText, blocks };
};
