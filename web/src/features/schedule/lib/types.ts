import type { CategoryRow } from '@/lib/types';

export interface ScheduleRow {
  id: number;
  title: string;
  date: string | null;
  end_date: string | null;
  status: string;
  category: string | null;
  subcategory: string | null;
  memo: string | null;
  important: boolean;
  created_at?: string;
}

export type ScheduleStatus = 'todo' | 'in-progress' | 'done' | 'cancelled';

export const SCHEDULE_STATUSES: ScheduleStatus[] = ['todo', 'in-progress', 'done', 'cancelled'];

const VALID_STATUSES = new Set<string>(SCHEDULE_STATUSES);

/** status 값이 유효한지 검증 */
export function isValidStatus(value: unknown): value is ScheduleStatus {
  return typeof value === 'string' && VALID_STATUSES.has(value);
}

/** 상태 정렬 순서: 진행중 → 할일 → 완료 → 취소 */
const STATUS_ORDER: Record<string, number> = {
  'in-progress': 0,
  todo: 1,
  done: 2,
  cancelled: 3,
};

/** 상태 기준 정렬 비교 함수 */
export function compareByStatus(a: ScheduleRow, b: ScheduleRow): number {
  return (STATUS_ORDER[a.status] ?? 4) - (STATUS_ORDER[b.status] ?? 4);
}

export const STATUS_LABELS: Record<ScheduleStatus, string> = {
  todo: '할일',
  'in-progress': '진행중',
  done: '완료',
  cancelled: '취소',
};

/** 기간 일정 여부 */
export function isMultiDaySchedule(s: ScheduleRow): boolean {
  return !!s.end_date && s.end_date !== s.date;
}

/** 일정 우선순위 정렬: 기간 일정 → 중요 → 카테고리순 → 상태순 */
export function compareSchedulePriority(
  a: ScheduleRow,
  b: ScheduleRow,
  categories: CategoryRow[],
): number {
  // 1. event 타입 최상위
  const catA = categories.find((c) => c.name === a.category);
  const catB = categories.find((c) => c.name === b.category);
  const aEvent = catA?.type === 'event';
  const bEvent = catB?.type === 'event';
  if (aEvent !== bEvent) return aEvent ? -1 : 1;

  // 2. 기간 일정
  const aMulti = isMultiDaySchedule(a);
  const bMulti = isMultiDaySchedule(b);
  if (aMulti !== bMulti) return aMulti ? -1 : 1;

  // 2. 활성(진행중/할일) vs 완료/취소 — 활성이 위
  const aActive = a.status === 'in-progress' || a.status === 'todo';
  const bActive = b.status === 'in-progress' || b.status === 'todo';
  if (aActive !== bActive) return aActive ? -1 : 1;

  // 3. 같은 그룹 내에서 중요 일정 우선
  if (a.important !== b.important) return a.important ? -1 : 1;

  // 4. 상태순 (진행중 > 할일, 완료 > 취소)
  const statusDiff = compareByStatus(a, b);
  if (statusDiff !== 0) return statusDiff;

  // 5. 카테고리 sort_order
  const orderA = a.category ? (catA?.sort_order ?? 999) : 9999;
  const orderB = b.category ? (catB?.sort_order ?? 999) : 9999;
  return orderA - orderB;
}
