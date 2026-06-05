import { describe, it, expect } from 'vitest';
import {
  updatePosterior,
  posteriorMean,
  credibleInterval,
  cumulativePosteriorFromHitMiss,
  empiricalBetaPrior,
} from '../bayesian-posterior.js';

describe('updatePosterior', () => {
  it('hit → α+1, β 그대로', () => {
    expect(updatePosterior({ alpha: 1, beta: 1 }, 'hit')).toEqual({ alpha: 2, beta: 1 });
  });

  it('miss → α 그대로, β+1', () => {
    expect(updatePosterior({ alpha: 1, beta: 1 }, 'miss')).toEqual({ alpha: 1, beta: 2 });
  });

  it('연속 hit 3회 → α=4', () => {
    let p = { alpha: 1, beta: 1 };
    p = updatePosterior(p, 'hit');
    p = updatePosterior(p, 'hit');
    p = updatePosterior(p, 'hit');
    expect(p).toEqual({ alpha: 4, beta: 1 });
  });
});

describe('posteriorMean', () => {
  it('Beta(1,1) → 0.5 (uniform prior)', () => {
    expect(posteriorMean(1, 1)).toBeCloseTo(0.5, 6);
  });

  it('Beta(2,1) → 2/3', () => {
    expect(posteriorMean(2, 1)).toBeCloseTo(2 / 3, 6);
  });

  it('Beta(11,6) — 10 hit + 5 miss + prior → 11/17', () => {
    expect(posteriorMean(11, 6)).toBeCloseTo(11 / 17, 6);
  });

  it('α+β=0 → NaN', () => {
    expect(Number.isNaN(posteriorMean(0, 0))).toBe(true);
  });

  it('Infinity → NaN', () => {
    expect(Number.isNaN(posteriorMean(Infinity, 1))).toBe(true);
    expect(Number.isNaN(posteriorMean(1, Infinity))).toBe(true);
  });
});

describe('credibleInterval', () => {
  it('Beta(2,1) 95% CI — lower < mean < upper, mean=2/3', () => {
    const { lower, upper } = credibleInterval(2, 1, 0.95);
    expect(lower).toBeGreaterThan(0);
    expect(upper).toBeLessThanOrEqual(1);
    expect(lower).toBeLessThan(2 / 3);
    expect(upper).toBeGreaterThan(2 / 3);
  });

  it('큰 N — Beta(51,11) 95% CI는 평균 근방으로 좁아짐', () => {
    const mean = 51 / 62; // ≈ 0.823
    const { lower, upper } = credibleInterval(51, 11, 0.95);
    expect(upper - lower).toBeLessThan(0.25);
    expect(lower).toBeLessThan(mean);
    expect(upper).toBeGreaterThan(mean);
  });

  it('작은 N — Beta(2,2) 95% CI는 매우 넓음 (N 적을 때 자연 페널티)', () => {
    const { lower, upper } = credibleInterval(2, 2, 0.95);
    expect(upper - lower).toBeGreaterThan(0.7);
  });

  it('α≤0 또는 β≤0 → NaN', () => {
    expect(Number.isNaN(credibleInterval(0, 1).lower)).toBe(true);
    expect(Number.isNaN(credibleInterval(1, 0).upper)).toBe(true);
    expect(Number.isNaN(credibleInterval(-1, 5).lower)).toBe(true);
  });

  it('비유효 conf → NaN', () => {
    expect(Number.isNaN(credibleInterval(2, 1, 0).lower)).toBe(true);
    expect(Number.isNaN(credibleInterval(2, 1, 1).upper)).toBe(true);
    expect(Number.isNaN(credibleInterval(2, 1, NaN).lower)).toBe(true);
  });
});

describe('cumulativePosteriorFromHitMiss', () => {
  it('0/0 → Beta(1,1) (prior 그대로)', () => {
    expect(cumulativePosteriorFromHitMiss(0, 0)).toEqual({ alpha: 1, beta: 1 });
  });

  it('10/5 → Beta(11,6)', () => {
    expect(cumulativePosteriorFromHitMiss(10, 5)).toEqual({ alpha: 11, beta: 6 });
  });

  it('대용량 누적 — 일관성', () => {
    const p = cumulativePosteriorFromHitMiss(200, 100);
    expect(p.alpha).toBe(201);
    expect(p.beta).toBe(101);
    expect(posteriorMean(p.alpha, p.beta)).toBeCloseTo(201 / 302, 6);
  });

  it('EB prior 주입 — Beta(α0,β0) + hit/miss', () => {
    expect(cumulativePosteriorFromHitMiss(10, 5, { alpha: 3, beta: 2 })).toEqual({
      alpha: 13,
      beta: 7,
    });
  });
});

describe('empiricalBetaPrior', () => {
  it('표본 <2 → uniform (1,1) fallback', () => {
    expect(empiricalBetaPrior([])).toEqual({ alpha: 1, beta: 1 });
    expect(empiricalBetaPrior([{ hits: 5, misses: 5 }])).toEqual({ alpha: 1, beta: 1 });
  });

  it('n=0 표본은 제외 → 유효 <2면 uniform', () => {
    expect(
      empiricalBetaPrior([
        { hits: 0, misses: 0 },
        { hits: 3, misses: 1 },
      ]),
    ).toEqual({
      alpha: 1,
      beta: 1,
    });
  });

  it('분산 있는 다중 표본 → MoM prior, 평균이 rate 평균 근방', () => {
    // rates: 0.8, 0.6, 0.4, 0.2 → mean 0.5
    const prior = empiricalBetaPrior([
      { hits: 8, misses: 2 },
      { hits: 6, misses: 4 },
      { hits: 4, misses: 6 },
      { hits: 2, misses: 8 },
    ]);
    expect(posteriorMean(prior.alpha, prior.beta)).toBeCloseTo(0.5, 1);
    expect(prior.alpha).toBeGreaterThan(0);
    expect(prior.beta).toBeGreaterThan(0);
  });

  it('농도 상한 — 분산 0(모든 rate 동일)이어도 prior가 폭주하지 않음', () => {
    const prior = empiricalBetaPrior([
      { hits: 5, misses: 5 },
      { hits: 5, misses: 5 },
      { hits: 5, misses: 5 },
    ]);
    // 분산 0 → uniform fallback (v<=0)
    expect(prior).toEqual({ alpha: 1, beta: 1 });
  });

  it('농도 CAP 적용 — 분산 매우 작아도 α+β ≤ 50', () => {
    const prior = empiricalBetaPrior([
      { hits: 50, misses: 50 },
      { hits: 51, misses: 49 },
      { hits: 49, misses: 51 },
    ]);
    expect(prior.alpha + prior.beta).toBeLessThanOrEqual(50 + 1e-6);
  });
});
