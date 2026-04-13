/** 수면 기록 (sleep_records 테이블 매핑) */
export interface SleepRecord {
  id: number;
  date: string;
  bedtime: string | null;
  wake_time: string | null;
  duration_minutes: number | null;
  sleep_type: 'night' | 'nap';
  memo: string | null;
}

/** 수면 이벤트 — 중간 기상 (sleep_events 테이블 매핑) */
export interface SleepEvent {
  id: number;
  date: string;
  event_time: string;
  memo: string | null;
}

/** 수면 기록 + 해당 날짜의 이벤트 조인 */
export interface SleepRecordWithEvents extends SleepRecord {
  events: SleepEvent[];
}

/** 요일별 패턴 집계 */
export interface DayOfWeekPattern {
  day: number; // 0=일, 1=월, ..., 6=토
  dayName: string;
  avgDuration: number; // 분
  avgBedtime: number; // 분 (자정 기준, 예: 23:30 = -30, 00:30 = 30)
  avgWakeTime: number; // 분 (자정 기준)
  count: number;
}

/** 대시보드 요약 통계 */
export interface SleepSummary {
  avgDuration: number; // 분
  avgBedtime: string; // HH:MM
  avgWakeTime: string; // HH:MM
  totalMidWakes: number;
  avgMidWakesPerNight: number;
  regularityScore: number; // 0~100
  totalNights: number;
}

/** 대시보드 API 응답 */
export interface SleepDashboardData {
  records: SleepRecordWithEvents[];
  summary: SleepSummary;
  dayOfWeekPattern: DayOfWeekPattern[];
}

/** 기간 선택 타입 */
export type SleepPeriod = '1w' | '2w' | '1m';
