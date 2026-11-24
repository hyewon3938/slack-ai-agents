/**
 * 루틴 체크리스트 블록과 버튼 value 인코딩/파싱.
 */

import type { KnownBlock } from '@slack/types';
import { formatDateShort } from '../../../shared/kst.js';
import type { RoutineRecordRow } from '../../../shared/life/queries-routine.js';
import { frequencyBadge } from '../../../shared/life/queries-routine.js';
import { ROUTINE_ACTION_ID, TIME_SLOT_ORDER } from './constants.js';

// ─── 루틴 필터 인코딩/파싱 ──────────────────────────────

export interface SlotFilter {
  targetSlots: string[];
  incompleteFrom: string[];
}

const encodeFilter = (filter?: SlotFilter): string => {
  if (!filter || filter.targetSlots.length === 0) return '';
  return `|${filter.targetSlots.join(',')}|${filter.incompleteFrom.join(',')}`;
};

/** 버튼 value에서 recordId + date + 필터 컨텍스트 파싱 */
export const parseButtonValue = (
  value: string,
): { recordId: number; date: string | null; filter: SlotFilter | null } => {
  const parts = value.split('|');
  // recordId:date 또는 recordId (하위 호환)
  const idPart = parts[0] ?? '';
  const colonIdx = idPart.indexOf(':');
  const recordId = colonIdx >= 0 ? Number(idPart.slice(0, colonIdx)) : Number(idPart);
  const date = colonIdx >= 0 ? idPart.slice(colonIdx + 1) : null;
  if (parts.length < 2 || !parts[1]) return { recordId, date, filter: null };
  const targetSlots = parts[1].split(',').filter(Boolean);
  const incompleteFrom = parts[2]?.split(',').filter(Boolean) ?? [];
  return { recordId, date, filter: { targetSlots, incompleteFrom } };
};

// ─── 루틴 체크리스트 ────────────────────────────────────

/** 루틴 체크리스트 Block Kit 빌드 (today = 레코드 날짜, 버튼 value에 인코딩) */
export const buildRoutineBlocks = (
  records: RoutineRecordRow[],
  today: string,
  slotFilter?: SlotFilter,
): { text: string; blocks: KnownBlock[] } => {
  const blocks: KnownBlock[] = [];
  const todayFormatted = formatDateShort(today);

  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: `${todayFormatted} 루틴 체크`, emoji: true },
  });

  for (const slot of TIME_SLOT_ORDER) {
    const slotRecords = records.filter((r) => r.time_slot === slot);
    if (slotRecords.length === 0) continue;

    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*${slot}*` },
    });

    for (const record of slotRecords) {
      const badge = frequencyBadge(record.frequency);
      const suffix = badge ? ` ${badge}` : '';

      if (record.completed) {
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: `~${record.name}~${suffix}` },
        });
      } else {
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: `${record.name}${suffix}` },
          accessory: {
            type: 'button',
            text: { type: 'plain_text', text: '완료 ✓', emoji: true },
            action_id: ROUTINE_ACTION_ID,
            value: `${record.id}:${today}${encodeFilter(slotFilter)}`,
          },
        });
      }

      // 루틴 메모 표시
      if (record.memo) {
        blocks.push({
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: record.completed
                ? record.memo
                    .split('\n')
                    .map((l) => `~${l}~`)
                    .join('\n')
                : record.memo,
            },
          ],
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

/** 시간대 필터링된 체크리스트 (크론 알림용) */
export const buildFilteredRoutineBlocks = (
  records: RoutineRecordRow[],
  today: string,
  targetSlots: readonly string[],
  includeIncompleteFrom?: readonly string[],
): { text: string; blocks: KnownBlock[] } => {
  const filtered = records.filter((r) => {
    if (targetSlots.includes(r.time_slot)) return true;
    if (includeIncompleteFrom?.includes(r.time_slot) && !r.completed) return true;
    return false;
  });

  const slotFilter: SlotFilter = {
    targetSlots: [...targetSlots],
    incompleteFrom: includeIncompleteFrom ? [...includeIncompleteFrom] : [],
  };

  return buildRoutineBlocks(filtered, today, slotFilter);
};
