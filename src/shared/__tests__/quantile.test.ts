import { describe, it, expect } from 'vitest';
import { quantileSorted, tertileCuts, classifyBand, isBand } from '../quantile.js';

describe('quantileSorted', () => {
  it('빈 배열 → NaN', () => {
    expect(Number.isNaN(quantileSorted([], 0.5))).toBe(true);
  });

  it('단일 값 → 그 값', () => {
    expect(quantileSorted([7], 0.33)).toBe(7);
  });

  it('선형보간 (R-7) — 중앙값/분위수', () => {
    const s = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    expect(quantileSorted(s, 0.5)).toBe(4);
    expect(quantileSorted(s, 1 / 3)).toBeCloseTo(2.667, 2);
    expect(quantileSorted(s, 2 / 3)).toBeCloseTo(5.333, 2);
  });
});

describe('tertileCuts', () => {
  it('균등 분포 → low≈1/3, high≈2/3 분위', () => {
    const cuts = tertileCuts([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(cuts.low).toBeCloseTo(2.667, 2);
    expect(cuts.high).toBeCloseTo(5.333, 2);
  });

  it('입력 정렬 불요 (내부 정렬)', () => {
    const cuts = tertileCuts([8, 0, 4, 2, 6]);
    expect(cuts.low).toBeLessThan(cuts.high);
  });

  it('NaN 섞임 → 제거 후 계산', () => {
    const cuts = tertileCuts([0, NaN, 3, 6, NaN]);
    expect(Number.isFinite(cuts.low)).toBe(true);
    expect(Number.isFinite(cuts.high)).toBe(true);
  });

  it('빈 입력 → NaN 컷', () => {
    const cuts = tertileCuts([]);
    expect(Number.isNaN(cuts.low)).toBe(true);
  });

  it('전부 동값 → low==high (밴드 붕괴)', () => {
    const cuts = tertileCuts([5, 5, 5, 5]);
    expect(cuts.low).toBe(5);
    expect(cuts.high).toBe(5);
  });
});

describe('classifyBand', () => {
  const cuts = { low: 2.667, high: 5.333 };

  it('value < low → low', () => {
    expect(classifyBand(1, cuts)).toBe('low');
  });

  it('low ≤ value < high → mid (low 경계는 mid)', () => {
    expect(classifyBand(4, cuts)).toBe('mid');
    expect(classifyBand(2.667, cuts)).toBe('mid');
  });

  it('value ≥ high → high (high 경계는 high)', () => {
    expect(classifyBand(8, cuts)).toBe('high');
    expect(classifyBand(5.333, cuts)).toBe('high');
  });

  it('NaN 컷(샘플 없음) → null', () => {
    expect(classifyBand(1, { low: NaN, high: NaN })).toBeNull();
  });

  it('low==high 붕괴 → value≥컷이면 high, 미만이면 low (mid 소멸)', () => {
    const c = { low: 5, high: 5 };
    expect(classifyBand(5, c)).toBe('high');
    expect(classifyBand(4, c)).toBe('low');
  });
});

describe('isBand', () => {
  it('유효 밴드만 true', () => {
    expect(isBand('low')).toBe(true);
    expect(isBand('mid')).toBe(true);
    expect(isBand('high')).toBe(true);
    expect(isBand('strong')).toBe(false);
    expect(isBand(null)).toBe(false);
    expect(isBand(1)).toBe(false);
  });
});
