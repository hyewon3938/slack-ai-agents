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

/** 날짜별 통합 수면 데이터 (대시보드 차트용 렌더 단위) */
export interface DailySleep {
  date: string;
  /** 밤잠 세그먼트 (bedtime 있는 night 레코드, 래핑 취침시각 오름차순). 분할 수면이면 N개 */
  nightSegments: SleepRecordWithEvents[];
  /** 시간 미확정 밤잠 레코드 (bedtime NULL, 메모 전용) */
  nightMemoRecords: SleepRecordWithEvents[];
  /** 해당 날짜의 중간기상 이벤트 (id 기준 dedup, event_time 오름차순) */
  nightEvents: SleepEvent[];
  /** 아침잠 (nap, bedtime < 12:00) */
  morningSleeps: SleepRecord[];
  /** 낮잠 (nap, bedtime >= 12:00) */
  afternoonNaps: SleepRecord[];
  /** 세그먼트 duration 합 + 아침잠 합 (분) */
  totalNightDurationMinutes: number;
  /** 기상 시각 — ① 아침잠 최후 wake ② 마지막 세그먼트 wake_time ③ 종료 래핑 환산 ④ null */
  effectiveWakeTime: string | null;
  /** 세그먼트 사이 갭 합 (수면 중 각성, 분) */
  wasoMinutes: number;
  /** 첫 취침 ~ 마지막 세그먼트 종료 (분, 세그먼트 0개면 0) */
  timeInBedMinutes: number;
  /** nightEvents 수 + max(0, 세그먼트 수 − 1) */
  fragmentationCount: number;
}

/** 수면 점수 4축 + 종합 (각 0~100) — 계산은 scores.ts, 상수는 sleep-score-config.ts */
export interface SleepScores {
  duration: number;
  /** 표본 부족(취침·기상 둘 다 2일 미만) 시 null */
  regularity: number | null;
  continuity: number;
  timing: number;
  /** 가용 축 가중 평균 (null 축은 가중치 재정규화), 반올림 */
  total: number;
}

/** 대시보드 요약 통계 */
export interface SleepSummary {
  avgDuration: number; // 분
  avgBedtime: string; // HH:MM
  avgWakeTime: string; // HH:MM
  totalMidWakes: number;
  avgMidWakesPerNight: number;
  /** 수면 점수 4축 + 종합. 밤잠 데이터 없으면 null */
  scores: SleepScores | null;
  /** Σ세그먼트 duration / Σ timeInBed × 100 (timeInBed>0인 날 대상, 반올림). 대상 없으면 null */
  avgEfficiencyPct: number | null;
  /** 세그먼트 있는 날의 wasoMinutes 평균 (반올림, 없으면 0) */
  avgWasoMinutes: number;
  totalNights: number;
  napDaysCount: number; // 낮잠을 잔 날 수
  avgNapMinutes: number; // 낮잠 일수 중 평균 낮잠 시간(분)
  totalNapMinutes: number; // 기간 내 낮잠 총합(분)
}

/** 대시보드 API 응답 */
export interface SleepDashboardData {
  records: SleepRecordWithEvents[];
  dailySleeps: DailySleep[];
  summary: SleepSummary;
  dayOfWeekPattern: DayOfWeekPattern[];
}

/** 기간 선택 타입 */
export type SleepPeriod = '1w' | '2w' | '1m';
