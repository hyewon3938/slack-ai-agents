// ─── 타입 ───────────────────────────────────────────────

export interface WeeklySleepData {
  avgDuration: number;
  recordCount: number;
  bestDay: { date: string; duration: number } | null;
  worstDay: { date: string; duration: number } | null;
}

export interface WeeklyRoutineData {
  thisWeekRate: number;
  thisWeekCompleted: number;
  thisWeekTotal: number;
  lastWeekRate: number | null;
  slotBreakdown: { slot: string; rate: number }[];
  bestRoutine: { name: string; rate: number } | null;
  worstRoutine: { name: string; rate: number } | null;
}

export interface WeeklyScheduleData {
  completedCount: number;
  incompleteCount: number;
  cancelledCount: number;
  categories: { category: string; count: number }[];
  overdueCount: number;
}

export interface SleepRoutineCorrelation {
  goodSleepRate: number | null;
  badSleepRate: number | null;
}

export interface SajuSeedOutcome {
  name: string;
  sipsin: string | null;
  description: string | null;
  hit: number;
  miss: number;
  inconclusive: number;
  hitRate: number | null;
}

export interface SajuOutcomeData {
  seeds: SajuSeedOutcome[];
  weakCandidates: SajuSeedOutcome[];
}

export interface WeeklyReportData {
  sleep: WeeklySleepData;
  routine: WeeklyRoutineData;
  schedule: WeeklyScheduleData;
  correlation: SleepRoutineCorrelation;
  saju: SajuOutcomeData;
  weekStart: string;
  weekEnd: string;
}
