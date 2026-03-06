import type { KnownBlock } from '@slack/types';
import type { RoutineRecord } from '../../shared/routine-notion.js';

const ACTION_ID = 'routine_complete';

const TIME_SLOT_ORDER = ['아침', '점심', '저녁', '밤'] as const;
const TIME_SLOT_EMOJI: Record<string, string> = {
  '아침': ':sunrise:',
  '점심': ':sunny:',
  '저녁': ':city_sunset:',
  '밤': ':crescent_moon:',
};

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** "YYYY-MM-DD" → "3/7(토)" */
export const formatDateShort = (dateStr: string): string => {
  const d = new Date(dateStr + 'T00:00:00+09:00');
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const dayName = DAY_NAMES[d.getDay()];
  return `${month}/${day}(${dayName})`;
};

/** 루틴 체크리스트 Block Kit 메시지 빌드 */
export const buildRoutineBlocks = (
  records: RoutineRecord[],
  today: string,
): { text: string; blocks: KnownBlock[] } => {
  const blocks: KnownBlock[] = [];
  const todayFormatted = formatDateShort(today);

  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: `${todayFormatted} 루틴 체크`, emoji: true },
  });

  for (const slot of TIME_SLOT_ORDER) {
    const slotRecords = records.filter((r) => r.timeSlot === slot);
    if (slotRecords.length === 0) continue;

    const emoji = TIME_SLOT_EMOJI[slot] ?? '';
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*${emoji} ${slot}*` },
    });

    for (const record of slotRecords) {
      if (record.completed) {
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: `~${record.title}~ :white_check_mark:` },
        });
      } else {
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: record.title },
          accessory: {
            type: 'button',
            text: { type: 'plain_text', text: '완료 ✓', emoji: true },
            action_id: ACTION_ID,
            value: record.id,
          },
        });
      }
    }
  }

  const total = records.length;
  const completed = records.filter((r) => r.completed).length;

  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `완료: ${completed}/${total}` }],
  });

  const text = `${todayFormatted} 루틴 체크 (${completed}/${total} 완료)`;
  return { text, blocks };
};

/** 시간대 필터링된 체크리스트 빌드 (크론 알림용) */
export const buildFilteredRoutineBlocks = (
  records: RoutineRecord[],
  today: string,
  targetSlots: readonly string[],
  includeIncompleteFrom?: readonly string[],
): { text: string; blocks: KnownBlock[] } => {
  const filtered = records.filter((r) => {
    if (targetSlots.includes(r.timeSlot)) return true;
    if (includeIncompleteFrom?.includes(r.timeSlot) && !r.completed) return true;
    return false;
  });

  return buildRoutineBlocks(filtered, today);
};

/** 밤 요약 메시지 빌드 */
export const buildNightSummaryBlocks = (
  records: RoutineRecord[],
  today: string,
): { text: string; blocks: KnownBlock[] } => {
  const result = buildRoutineBlocks(records, today);
  const total = records.length;
  const completed = records.filter((r) => r.completed).length;

  const summaryText =
    total === completed
      ? '오늘 루틴 전부 완료! 고생했어.'
      : `오늘 루틴 ${completed}/${total} 완료. 내일은 더 화이팅!`;

  result.blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: `\n${summaryText}` },
  });

  return result;
};
