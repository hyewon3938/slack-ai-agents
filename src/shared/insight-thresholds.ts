/**
 * 프로액티브 인사이트 엔진의 모든 패턴 임계치.
 * 한 곳에서 튜닝하여 Phase 4 사주 매핑 단계에서 일관된 조정 가능.
 */
export const INSIGHT_THRESHOLDS = {
  streak: {
    minStreak: 3,
    milestones: [3, 5, 7, 10, 14, 21, 30] as const,
    lookbackDays: 30,
  },
  sleepTrend: {
    windowDays: 3,
    shortSleepMinutes: 420,
  },
  slotGap: {
    minGap: 30,
    minSampleSize: 3,
    lookbackDays: 7,
  },
  weekComparison: {
    significantDiff: 5,
    largeDiff: 10,
  },
  overdueAlert: {
    minCount: 3,
  },
  categorySkew: {
    lookbackDays: 7,
    minTotalSchedules: 5,
    dominantRatio: 0.5,
  },
  drift: {
    windowWeeks: 4,
    bedtimeShiftMinutes: 30,
    wakeShiftMinutes: 30,
    midWakeIncreaseRatio: 1.5,
    minSampleNights: 4,
  },
  recovery: {
    minStreakBeforeBreak: 5,
    fastRecoveryDays: 1,
  },
  lapseAlert: {
    consecutiveDaysBeforeMiss: 7,
  },
  weeklyRegression: {
    prevWeekMinRate: 90,
    thisWeekMaxRate: 60,
  },
  spottyPattern: {
    lookbackDays: 7,
    minMissCount: 3,
    maxMissCount: 4,
  },
  pickByTiming: {
    minPriority: 5,
    maxItems: 3,
  },
  // #477 P2 주간 off-day 검증 엔진 임계치 (ADR-0032).
  // ⚠️ confirm은 provisional — 진짜 확정 게이트는 P3 e-value(1/α). 주간 반복 q는 optional stopping.
  patternVerification: {
    windowCapDays: 365, // 윈도우 상한(전체 이력 재계산, 캡)
    baselineWindowDays: 28, // above_avg/below_avg rolling baseline 일수 (signal.window_days 미지정 시 기본)
    minActiveDays: 30, // confirm/reject 최소 발현일 수
    confirmQ: 0.05, // BH-FDR q 임계 (provisional confirm)
    minRateRatio: 1.3, // confirm 최소 효과크기 (발현일 pass율 / 비발현일 pass율)
    rejectRatioLow: 0.95, // reject 효과크기 하한 (연관 없음 판정 밴드)
    rejectRatioHigh: 1.05, // reject 효과크기 상한
  },
} as const;
