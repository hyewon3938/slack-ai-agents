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
  // #477 P2/P3 주간 off-day 검증 엔진 임계치 (ADR-0032·0034·0035).
  // q는 screening, 확정 게이트는 e-value(1/α, optional stopping 통제). emerging은 hedged 가시성 tier.
  patternVerification: {
    windowCapDays: 365, // 윈도우 상한(전체 이력 재계산, 캡)
    baselineWindowDays: 28, // above_avg/below_avg rolling baseline 일수 (signal.window_days 미지정 시 기본)
    minActiveDays: 30, // confirm/reject 최소 발현일 수
    confirmQ: 0.05, // BH-FDR q 임계 (confirm screening — 통과 후 e-value가 최종 확정)
    minRateRatio: 1.3, // confirm 최소 효과크기 (발현일 pass율 / 비발현일 pass율)
    rejectRatioLow: 0.95, // reject 효과크기 하한 (연관 없음 판정 밴드)
    rejectRatioHigh: 1.05, // reject 효과크기 상한
    // ── P3 통계 증강 (ADR-0034 e-value, ADR-0035 등급별 노출) ──
    evalueAlpha: 0.05, // e-value 확정 게이트 유의수준
    evalueThreshold: 20, // = 1/evalueAlpha. e_value ≥ 20 → 'confirmed' 승격(verified tier)
    emergingMinEffect: 1.3, // emerging tier 효과크기 하한 (= confirm effect floor)
    emergingMinActive: 15, // emerging tier 최소 발현일 (verified 30보다 낮게, 튜닝 노브 ADR-0035)
    blockLen: 7, // block permutation 블록 길이 (자기상관 보정, ADR-0032)
    blockPermIters: 2000, // block permutation 반복수 (Monte Carlo p 정밀도)
    // ── P5a 발굴 트랙 (ADR-0039) — surface 전용. 확정은 위 e-value 트랙이 별도로 잡음 ──
    // 2층 통제: 느슨한 discoverQ로 후보만 띄우고(가족별 발견 BH-FDR), 믿음은 confirmQ+e-value.
    discoverQ: 0.15, // 발견 BH-FDR q (확정 confirmQ=0.05보다 느슨 — surface 전용)
    discoveryMinActive: 12, // 발굴 최소 발현일 (확정 minActiveDays=30보다 낮게 — 일찍 제안)
    discoveryMinEffect: 1.3, // 발굴 최소 효과크기 (= confirm floor, positive 연관만)
    discoveryMaxFisherP: 0.1, // block-perm 전 Fisher 사전선별 상한 (Monte Carlo 비용 절감)
    discoveryTopN: 5, // 주당 surface 상한 (승인 카드 폭주 방지 — 드롭 시 로그)
  },
} as const;
