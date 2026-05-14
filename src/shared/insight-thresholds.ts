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
} as const;
