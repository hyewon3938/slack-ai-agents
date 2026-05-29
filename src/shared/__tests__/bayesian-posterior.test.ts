import { describe, it, expect } from 'vitest';
import {
  updatePosterior,
  posteriorMean,
  credibleInterval,
  cumulativePosteriorFromHitMiss,
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
});
