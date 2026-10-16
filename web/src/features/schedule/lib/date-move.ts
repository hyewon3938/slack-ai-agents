import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';

export type DragType = 'move' | 'resize-left' | 'resize-right';

/** 일정의 날짜 범위 — 이동과 되돌리기가 함께 다루는 단위 */
export interface DateRange {
  date: string | null;
  end_date: string | null;
}

/** 되돌리기 기록 1건 — 옮기기 전후 범위 */
export interface MoveEntry {
  id: number;
  title: string;
  before: DateRange;
  after: DateRange;
}

export const UNDO_LIMIT = 20;

function shiftDate(dateStr: string, days: number): string {
  return format(addDays(parseISO(dateStr), days), 'yyyy-MM-dd');
}

export function isSameRange(a: DateRange, b: DateRange): boolean {
  return a.date === b.date && (a.end_date ?? null) === (b.end_date ?? null);
}

/**
 * 드래그 종류와 놓은 날짜로 새 범위를 계산한다. 바뀌는 게 없으면 null.
 * 시작일과 종료일을 한 번에 계산해서 PATCH 1회·되돌리기 1단계로 묶는다.
 */
export function computeDragResult(
  type: DragType,
  current: DateRange,
  targetDate: string,
): DateRange | null {
  const start = current.date;
  if (!start) return null;
  const end = current.end_date && current.end_date >= start ? current.end_date : null;

  let next: DateRange;
  switch (type) {
    case 'resize-right':
      // 시작일 이하로 당기면 단일 일정
      next = { date: start, end_date: targetDate <= start ? null : targetDate };
      break;
    case 'resize-left': {
      // 마지막 날 이상으로 밀면 마지막 날 위치에서 단일 일정
      const lastDay = end ?? start;
      next =
        targetDate >= lastDay
          ? { date: lastDay, end_date: null }
          : { date: targetDate, end_date: lastDay };
      break;
    }
    case 'move': {
      if (targetDate === start) return null;
      // 기간 일정은 기간을 유지한 채 이동
      const days = differenceInCalendarDays(parseISO(targetDate), parseISO(start));
      next = { date: targetDate, end_date: end ? shiftDate(end, days) : null };
      break;
    }
  }

  return isSameRange(next, current) ? null : next;
}

/** 토스트에 보여줄 범위 문구 — 9/27, 9/27~10/19, 백로그 */
export function formatRangeLabel(range: DateRange): string {
  if (!range.date) return '백로그';
  const startLabel = format(parseISO(range.date), 'M/d');
  if (!range.end_date || range.end_date <= range.date) return startLabel;
  return `${startLabel}~${format(parseISO(range.end_date), 'M/d')}`;
}
