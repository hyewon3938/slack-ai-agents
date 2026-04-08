/** 루틴 템플릿 */
export interface RoutineTemplateRow {
  id: number;
  name: string;
  time_slot: string | null; // '낮' | '밤'
  frequency: string | null; // '매일' | '격일' | '주1회' | 'N일마다'
  active: boolean;
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

/** 시간대 옵션 */
export const ROUTINE_TIME_SLOTS = [
  { value: '낮', label: '낮' },
  { value: '밤', label: '밤' },
] as const;
