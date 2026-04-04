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

export type CategoryType = 'task' | 'event';

export const CATEGORY_TYPES: { value: CategoryType; label: string }[] = [
  { value: 'task', label: '할일' },
  { value: 'event', label: '일정' },
];

export interface CategoryRow {
  id: number;
  name: string;
  color: string;
  type: CategoryType;
  sort_order: number;
  parent_id: number | null;
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

/** 프리셋 색상 (파스텔 hex) */
export const PRESET_COLORS: Record<string, string> = {
  violet: '#ddd6fe',
  amber: '#fde68a',
  rose: '#fecdd3',
  emerald: '#a7f3d0',
  sky: '#bae6fd',
  blue: '#bfdbfe',
  orange: '#fed7aa',
  pink: '#fbcfe8',
  teal: '#99f6e4',
  indigo: '#c7d2fe',
  gray: '#e5e7eb',
};

/** hex 색상의 상대 밝기 (0~1) */
function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** hex 값에서 배경색 기반 스타일 생성 (색상 → 배경, 텍스트 자동 결정) */
export function hexToStyles(hex: string): { bg: string; border: string; text: string } {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const textColor = luminance(hex) > 0.45 ? '#1f2937' : '#ffffff';
  return {
    bg: `rgba(${r}, ${g}, ${b}, 0.85)`,
    border: `rgba(${r}, ${g}, ${b}, 1)`,
    text: textColor,
  };
}

/** 색상 키(프리셋명 또는 hex)에서 인라인 스타일 생성 */
export function getCategoryStyle(colorKey: string): { bg: string; border: string; text: string } {
  const hex = colorToHex(colorKey);
  return hexToStyles(hex);
}

/** 색상 키에서 hex 값 가져오기 */
export function colorToHex(colorKey: string): string {
  return PRESET_COLORS[colorKey] ?? (colorKey.startsWith('#') ? colorKey : '#6b7280');
}

export const COLOR_OPTIONS = Object.keys(PRESET_COLORS);

// ─── 루틴 ────────────────────────────────────────────

/** 루틴 템플릿 */
export interface RoutineTemplateRow {
  id: number;
  name: string;
  time_slot: string | null; // '낮' | '밤'
  frequency: string | null; // '매일' | '격일' | '주1회' | 'N일마다'
  active: boolean;
  created_at?: string;
}

/** 루틴 기록 (JOIN 결과) */
export interface RoutineRecordRow {
  id: number;
  template_id: number;
  date: string;
  completed: boolean;
  completed_at: string | null;
  memo: string | null;
  name: string;
  time_slot: string | null;
  frequency: string | null;
}

/** 루틴 일별 통계 */
export interface RoutineDayStat {
  date: string;
  total: number;
  completed: number;
  rate: number; // 0~100
}

/** 루틴별 달성률 통계 */
export interface RoutinePerStat {
  template_id: number;
  name: string;
  total: number;
  completed: number;
  rate: number; // 0~100
}

/** 빈도 옵션 */
export const ROUTINE_FREQUENCIES = [
  { value: '매일', label: '매일' },
  { value: '격일', label: '격일' },
  { value: '주1회', label: '주 1회' },
  { value: '3일마다', label: '3일마다' },
] as const;

/** 시간대 옵션 */
export const ROUTINE_TIME_SLOTS = [
  { value: '낮', label: '낮' },
  { value: '밤', label: '밤' },
] as const;

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
