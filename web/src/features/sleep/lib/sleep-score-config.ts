/** 수면 점수 상수 — 근거·조정 이력은 docs/adr/0059-sleep-score-architecture.md */
export const SLEEP_SCORE_CONFIG = {
  duration: { targetMinMinutes: 420, targetMaxMinutes: 540, zeroAtDeviationMinutes: 180 },
  regularity: { zeroAtStdDevMinutes: 120 },
  continuity: { zeroAtFragmentsPerNight: 3 },
  timing: { targetBedtimeMinutes: 0, zeroAtLateMinutes: 180 },
  weights: { duration: 0.35, regularity: 0.25, continuity: 0.2, timing: 0.2 },
} as const;
