/**
 * Beta-Binomial Bayesian posterior 헬퍼 — ADR-0024 실행 (마스터 #434 Phase 7).
 *
 * - prior Beta(1,1) (uniform) 가정
 * - hit 1회 → α+1, miss 1회 → β+1
 * - posterior mean = α / (α+β)
 * - 95% credible interval = Beta inverse CDF (`@stdlib/stats-base-dists-beta-quantile`)
 *
 * 가설 단위 누적용으로 `cumulativePosteriorFromHitMiss` 사용.
 * 매트릭 단위 SQL inline UPDATE는 매칭 cron에 그대로 유지(atomicity).
 */

import betaQuantile from '@stdlib/stats-base-dists-beta-quantile';

export interface BetaPosterior {
  alpha: number;
  beta: number;
}

export const updatePosterior = (prior: BetaPosterior, outcome: 'hit' | 'miss'): BetaPosterior =>
  outcome === 'hit'
    ? { alpha: prior.alpha + 1, beta: prior.beta }
    : { alpha: prior.alpha, beta: prior.beta + 1 };

export const posteriorMean = (alpha: number, beta: number): number => {
  if (!Number.isFinite(alpha) || !Number.isFinite(beta)) return NaN;
  const denom = alpha + beta;
  return denom > 0 ? alpha / denom : NaN;
};

export const credibleInterval = (
  alpha: number,
  beta: number,
  conf = 0.95,
): { lower: number; upper: number } => {
  if (
    !Number.isFinite(alpha) ||
    !Number.isFinite(beta) ||
    alpha <= 0 ||
    beta <= 0 ||
    !Number.isFinite(conf) ||
    conf <= 0 ||
    conf >= 1
  ) {
    return { lower: NaN, upper: NaN };
  }
  const tail = (1 - conf) / 2;
  return {
    lower: betaQuantile(tail, alpha, beta),
    upper: betaQuantile(1 - tail, alpha, beta),
  };
};

/** 누적 hit/miss → posterior (prior Beta(α,β) 기본 (1,1) uniform + 누적). */
export const cumulativePosteriorFromHitMiss = (
  totalHits: number,
  totalMisses: number,
  prior: BetaPosterior = { alpha: 1, beta: 1 },
): BetaPosterior => ({
  alpha: prior.alpha + totalHits,
  beta: prior.beta + totalMisses,
});

/** empirical-Bayes prior 농도 상한 — v≈0(링크들이 과하게 일치)일 때 prior가 per-link 신호를 삼키는 것 방지. */
const EB_PRIOR_CONCENTRATION_CAP = 50;

/**
 * empirical-Bayes 공통 prior Beta(α0,β0) — 전 링크 발현일 pass율의 method-of-moments (#477 P3).
 * 표본(링크) <2 또는 분산/평균 degenerate면 uniform (1,1) fallback → 약한 수축(헌장 ④ 자동 활성).
 * 농도(α0+β0)는 CAP로 상한 → 데이터 적을 땐 prior 약함, 많아도 per-link 신호를 과하게 누르지 않음.
 */
export const empiricalBetaPrior = (
  samples: ReadonlyArray<{ hits: number; misses: number }>,
): BetaPosterior => {
  const uniform: BetaPosterior = { alpha: 1, beta: 1 };
  const rates: number[] = [];
  for (const s of samples) {
    const n = s.hits + s.misses;
    if (n > 0) rates.push(s.hits / n);
  }
  if (rates.length < 2) return uniform;
  const m = rates.reduce((a, b) => a + b, 0) / rates.length;
  const v = rates.reduce((a, b) => a + (b - m) * (b - m), 0) / rates.length;
  if (v <= 0 || m <= 0 || m >= 1) return uniform;
  const common = (m * (1 - m)) / v - 1;
  if (!Number.isFinite(common) || common <= 0) return uniform;
  const k = Math.min(common, EB_PRIOR_CONCENTRATION_CAP);
  const alpha = m * k;
  const beta = (1 - m) * k;
  if (alpha <= 0 || beta <= 0 || !Number.isFinite(alpha) || !Number.isFinite(beta)) return uniform;
  return { alpha, beta };
};
