import { timeToMinutesFromMidnight } from './queries';
import { SLEEP_SCORE_CONFIG } from './sleep-score-config';
import type { DailySleep, SleepScores } from './types';

// queries ↔ scores 상호 import는 함수 호출 시점에만 서로를 사용 (모듈 평가 시점 사용 없음 — 순환 안전)
export type { SleepScores } from './types';

/** 0~100 범위로 자름 */
function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/** 배열 평균 (빈 배열이면 null) */
function meanOrNull(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** 모집단 표준편차 (values 비어있지 않다는 전제) */
function populationStdDev(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

/** 취침 onset 래핑 분 목록 — 세그먼트 있는 날의 첫 세그먼트 bedtime */
function onsetMinutes(dailies: DailySleep[]): number[] {
  return dailies
    .filter((d) => d.nightSegments.length > 0)
    .map((d) => timeToMinutesFromMidnight(d.nightSegments[0]!.bedtime!));
}

/** 시간 축: 목표 구간 안 100, 벗어난 거리 비례 감점 (일별 clamp → 평균). 대상 0일이면 null */
function durationScore(dailies: DailySleep[]): number | null {
  const { targetMinMinutes, targetMaxMinutes, zeroAtDeviationMinutes } =
    SLEEP_SCORE_CONFIG.duration;
  const dayScores = dailies
    .filter((d) => d.totalNightDurationMinutes > 0)
    .map((d) => {
      const v = d.totalNightDurationMinutes;
      const deviation = Math.max(0, targetMinMinutes - v, v - targetMaxMinutes);
      return clampScore(100 - (deviation / zeroAtDeviationMinutes) * 100);
    });
  return meanOrNull(dayScores);
}

/** 타이밍 축: 목표 취침시각 초과분 비례 감점 (일별 clamp → 평균). 대상 0일이면 무근거 → 100 */
function timingScore(dailies: DailySleep[]): number {
  const { targetBedtimeMinutes, zeroAtLateMinutes } = SLEEP_SCORE_CONFIG.timing;
  const dayScores = onsetMinutes(dailies).map((onset) => {
    const late = Math.max(0, onset - targetBedtimeMinutes);
    return clampScore(100 - (late / zeroAtLateMinutes) * 100);
  });
  return meanOrNull(dayScores) ?? 100;
}

/** 규칙성 축: 취침·기상 래핑 분의 모집단 표준편차 비례 감점. 표본 ≥ 2인 쪽만 사용, 둘 다 미달이면 null */
function regularityScore(dailies: DailySleep[]): number | null {
  const { zeroAtStdDevMinutes } = SLEEP_SCORE_CONFIG.regularity;
  const wakeMinutes = dailies
    .filter((d) => d.effectiveWakeTime != null)
    .map((d) => timeToMinutesFromMidnight(d.effectiveWakeTime!));
  const sideScores = [onsetMinutes(dailies), wakeMinutes]
    .filter((samples) => samples.length >= 2)
    .map((samples) => clampScore(100 - (populationStdDev(samples) / zeroAtStdDevMinutes) * 100));
  return meanOrNull(sideScores);
}

/** 연속성 축: 밤당 평균 분절 수 비례 감점. 대상 0일이면 무근거 → 100 */
function continuityScore(dailies: DailySleep[]): number {
  const { zeroAtFragmentsPerNight } = SLEEP_SCORE_CONFIG.continuity;
  const days = dailies.filter((d) => d.nightSegments.length > 0);
  if (days.length === 0) return 100;
  const fragmentsPerNight = days.reduce((s, d) => s + d.fragmentationCount, 0) / days.length;
  return clampScore(100 - (fragmentsPerNight / zeroAtFragmentsPerNight) * 100);
}

/** DailySleep 목록 → 수면 점수 4축 + 종합. 밤잠(아침잠 합산) 데이터가 하루도 없으면 null */
export function calculateSleepScores(dailies: DailySleep[]): SleepScores | null {
  const duration = durationScore(dailies);
  if (duration === null) return null;

  const regularity = regularityScore(dailies);
  const continuity = continuityScore(dailies);
  const timing = timingScore(dailies);

  const { weights } = SLEEP_SCORE_CONFIG;
  const axes: { score: number; weight: number }[] = [
    { score: duration, weight: weights.duration },
    { score: continuity, weight: weights.continuity },
    { score: timing, weight: weights.timing },
  ];
  if (regularity !== null) {
    axes.push({ score: regularity, weight: weights.regularity });
  }

  const weightSum = axes.reduce((s, a) => s + a.weight, 0);
  const total = Math.round(axes.reduce((s, a) => s + a.score * (a.weight / weightSum), 0));

  return { duration, regularity, continuity, timing, total };
}
