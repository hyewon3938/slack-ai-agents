/**
 * 일정 텍스트 메시지 (크론 알림용).
 */

import { formatDateShort } from '../../../shared/kst.js';
import type { ScheduleRow } from '../../../shared/life/queries-schedule.js';
import { groupByCategory, isEventType, formatScheduleTitle } from './schedule-format.js';

// ─── 일정 텍스트 (크론 알림용 — 블록킷 없이) ────────────

/** 일정 텍스트 메시지 (블록킷 없이 순수 텍스트) */
export const buildScheduleText = (
  items: ScheduleRow[],
  targetDate: string,
  headerOverride?: string,
): string => {
  const formatted = formatDateShort(targetDate);
  const header = headerOverride ?? `${formatted} 일정이야.`;
  const groups = groupByCategory(items);
  const lines: string[] = [header, ''];

  for (const group of groups) {
    lines.push(`[${group.category}]`);
    for (const item of group.items) {
      lines.push(formatScheduleTitle(item));
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
};

/**
 * 미완료 일정 필터.
 * - event 타입 제외
 * - done/cancelled 제외
 * - 기간 일정(end_date 존재)이 오늘(today) 이후까지 이어지면(end_date >= today) 아직 진행 중이므로 제외.
 *   일정 최종 완료 검증은 end_date가 지난 다음 날 아침에 이뤄짐.
 *   예) 월~목 일정: 목요일 밤까진 진행 중 → 제외, 금요일 아침에 미완료로 검증.
 */
const filterIncompleteTasks = (items: ScheduleRow[], today: string): ScheduleRow[] =>
  items.filter(
    (s) =>
      !isEventType(s) &&
      s.status !== 'done' &&
      s.status !== 'cancelled' &&
      !(s.end_date != null && s.end_date >= today),
  );

/** 밤 미완료 일정 텍스트 (없으면 null) — event 타입 + 진행 중 기간 일정 제외 */
export const buildNightScheduleText = (items: ScheduleRow[], today: string): string | null => {
  const incomplete = filterIncompleteTasks(items, today);
  if (incomplete.length === 0) return null;
  return buildScheduleText(
    incomplete,
    today,
    '오늘 아직 못 끝낸 일정이야. 내일로 넘길 건 정리해둬!',
  );
};

/**
 * 아침용 어제 미완료 일정 텍스트 (없으면 null).
 * - yesterday: 헤더/그룹핑용 표시 날짜
 * - today: 진행 중 판단 기준 (end_date >= today이면 제외)
 */
export const buildYesterdayIncompleteText = (
  items: ScheduleRow[],
  yesterday: string,
  today: string,
): string | null => {
  const incomplete = filterIncompleteTasks(items, today);
  if (incomplete.length === 0) return null;
  return buildScheduleText(
    incomplete,
    yesterday,
    '어제 못 끝낸 일정이야. 오늘로 넘길 건 정리해둬!',
  );
};
