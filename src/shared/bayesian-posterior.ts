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

/** 누적 hit/miss → posterior (prior Beta(1,1) + 누적). */
export const cumulativePosteriorFromHitMiss = (
  totalHits: number,
  totalMisses: number,
): BetaPosterior => ({
  alpha: 1 + totalHits,
  beta: 1 + totalMisses,
});
