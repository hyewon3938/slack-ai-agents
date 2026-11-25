/** 루틴 추적 방식 — scheduled=빈도대로 기대된 발생, free=수행 시점에만 기록 (ADR-0061) */
export type RoutineTrackingMode = 'scheduled' | 'free';

/** API 입력 검증용 추적 방식 목록 */
export const TRACKING_MODES: readonly string[] = ['scheduled', 'free'];

/** 기록의 성격 — 생성 시점에 확정되고 소급 변경하지 않는다 (ADR-0061) */
export type RoutineEntryType = 'scheduled' | 'free';

/** 루틴 템플릿 */
export interface RoutineTemplateRow {
  id: number;
  name: string;
  time_slot: string | null; // '낮' | '밤'
  frequency: string | null; // '매일' | '격일' | '주1회' | 'N일마다'
  active: boolean;
  tracking_mode: RoutineTrackingMode;
  start_date?: string;
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
  entry_type: RoutineEntryType;
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
  time_slot: string | null;
  total: number;
  completed: number;
  rate: number; // 0~100
  days_active: number; // 생성 이후 경과 일수
}

/** 루틴 비활성 기간 */
export interface RoutineInactivePeriod {
  id: number;
  template_id: number;
  start_date: string;
  end_date: string | null; // null = 현재 비활성 중
}

/** 루틴별 히트맵 일별 데이터 */
export interface RoutineHeatmapDay {
  date: string;
  completed: boolean;
}

/** 루틴 히트맵 API 응답 */
export interface RoutineHeatmapData {
  records: RoutineHeatmapDay[];
  inactivePeriods: RoutineInactivePeriod[];
  startDate: string;
}

/** 빈도 옵션 */
export const ROUTINE_FREQUENCIES = [
  { value: '매일', label: '매일' },
  { value: '격일', label: '격일' },
  { value: '주1회', label: '주 1회' },
  { value: '3일마다', label: '3일마다' },
] as const;

/**
 * 간격 빈도(격일·주1회·N일마다)를 일수로 바꾼다. 매일이나 해석할 수 없는 값은 null.
 * N일마다는 Slack 봇이 만든 값(예: 3일마다)까지 받기 위해 N ≥ 1인 정수를 모두 허용한다.
 * 봇 `src/shared/life/queries-routine.ts`의 parseIntervalDays와 같은 규칙이다 — 한쪽을 바꾸면 다른 쪽도 맞춘다.
 */
export function parseIntervalDays(frequency: string): number | null {
  if (frequency === '격일') return 2;
  if (frequency === '주1회') return 7;
  const match = /^(\d+)일마다$/.exec(frequency);
  if (!match) return null;
  const days = Number(match[1]);
  return days >= 1 ? days : null;
}

/** 저장할 수 있는 빈도인지 — 빈도 없음(null)·매일·간격 빈도만 허용 */
export const isValidFrequency = (value: unknown): value is string | null =>
  value === null ||
  value === '매일' ||
  (typeof value === 'string' && parseIntervalDays(value) !== null);

/** 시간대 옵션 */
export const ROUTINE_TIME_SLOTS = [
  { value: '낮', label: '낮' },
  { value: '밤', label: '밤' },
] as const;
