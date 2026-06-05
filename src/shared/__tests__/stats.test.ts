import { describe, it, expect } from 'vitest';
import { fisherExact, bhFdr } from '../stats.js';

// ─── fisherExact ─────────────────────────────────────────

describe('fisherExact', () => {
  it('빈 표 → p=1', () => {
    expect(fisherExact(0, 0, 0, 0)).toBe(1);
  });

  it('Lady tasting tea (4우유+4차, 답 3/4 일치) → 양측 p ≈ 0.4857', () => {
    // 2x2: [[3,1],[1,3]]
    // 양측 = 2 * P(X=3) (P(X=3) = P(X=1) 대칭) — k∈{0,1,2,3,4}
    // P(X=3) = C(4,3)*C(4,1)/C(8,4) = 16/70
    // P(X=4) = C(4,4)*C(4,0)/C(8,4) = 1/70
    // P(X=0) = 1/70, P(X=1) = 16/70 (대칭)
    // obs P(X=3)=16/70 → 같거나 작은: 0,1,3,4 → (1+16+16+1)/70 = 34/70 ≈ 0.4857
    expect(fisherExact(3, 1, 1, 3)).toBeCloseTo(34 / 70, 4);
  });

  it('완전 분리 [[10,0],[0,10]] → 매우 작은 p', () => {
    const p = fisherExact(10, 0, 0, 10);
    expect(p).toBeLessThan(0.001);
    expect(p).toBeGreaterThan(0);
  });

  it('완전 균등 [[5,5],[5,5]] → p=1 (전혀 다르지 않음)', () => {
    expect(fisherExact(5, 5, 5, 5)).toBeCloseTo(1, 4);
  });

  it('대칭성 — [[a,b],[c,d]] = [[c,d],[a,b]]', () => {
    expect(fisherExact(3, 7, 8, 2)).toBeCloseTo(fisherExact(8, 2, 3, 7), 6);
  });

  it('음수 입력 → NaN', () => {
    expect(Number.isNaN(fisherExact(-1, 2, 3, 4))).toBe(true);
  });

  it('p-value는 [0, 1] 범위', () => {
    const tables: Array<[number, number, number, number]> = [
      [3, 5, 4, 8],
      [1, 9, 9, 1],
      [7, 3, 2, 8],
    ];
    for (const [a, b, c, d] of tables) {
      const p = fisherExact(a, b, c, d);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });
});

// ─── bhFdr ───────────────────────────────────────────────

describe('bhFdr', () => {
  it('단일 p-value → q = p', () => {
    expect(bhFdr([0.04])).toEqual([0.04]);
  });

  it('빈 입력 → 빈 배열', () => {
    expect(bhFdr([])).toEqual([]);
  });

  it('monotone 보장 — 정렬 후 q[i] ≤ q[i+1]', () => {
    const p = [0.001, 0.05, 0.5, 0.9];
    const [q0, q1, q2, q3] = bhFdr(p) as [number, number, number, number];
    expect(q0).toBeLessThanOrEqual(q1);
    expect(q1).toBeLessThanOrEqual(q2);
    expect(q2).toBeLessThanOrEqual(q3);
  });

  it('원래 순서 유지 — shuffled input', () => {
    const p = [0.5, 0.001, 0.9, 0.05];
    const q = bhFdr(p) as [number, number, number, number];
    expect(q).toHaveLength(4);
    // smallest p (0.001) at index 1 → q[1]은 모든 인덱스 중 최소
    expect(q[1]).toBeLessThan(q[0]);
    expect(q[1]).toBeLessThan(q[2]);
    expect(q[1]).toBeLessThan(q[3]);
  });

  it('알려진 결과 — Benjamini-Hochberg 1995 표준 사례', () => {
    // p = [0.0001, 0.0004, 0.0019, 0.0095, 0.0201, 0.0278, 0.0298, 0.0344, 0.0459, 0.3240, 0.4262, 0.5719, 0.6528, 0.7590, 1.0]
    // N=15. q[1] = 0.0001 * 15 / 1 = 0.0015 (then monotone)
    // 첫 7개는 통상 q<0.05
    const p = [
      0.0001, 0.0004, 0.0019, 0.0095, 0.0201, 0.0278, 0.0298, 0.0344, 0.0459, 0.324, 0.4262, 0.5719,
      0.6528, 0.759, 1.0,
    ];
    const q = bhFdr(p);
    expect(q[0]).toBeCloseTo(0.0015, 4); // 0.0001 * 15 / 1
    // q monotone 검증
    for (let i = 1; i < q.length; i++) {
      const cur = q[i] ?? -Infinity;
      const prev = q[i - 1] ?? -Infinity;
      expect(cur).toBeGreaterThanOrEqual(prev);
    }
    // q ≤ 1
    for (const v of q) expect(v).toBeLessThanOrEqual(1);
  });

  it('NaN p-value는 NaN q로 유지, 나머지만 보정', () => {
    const [q0, q1, q2, q3, q4] = bhFdr([0.01, NaN, 0.5, NaN, 0.02]) as [
      number,
      number,
      number,
      number,
      number,
    ];
    expect(Number.isNaN(q1)).toBe(true);
    expect(Number.isNaN(q3)).toBe(true);
    expect(Number.isNaN(q0)).toBe(false);
    expect(Number.isNaN(q2)).toBe(false);
    expect(Number.isNaN(q4)).toBe(false);
    // 유효 3개에 대한 BH-FDR
    // sorted: [0.01, 0.02, 0.5], rank 1,2,3
    // qRaw: 0.03, 0.03, 0.5 → monotone: 0.03, 0.03, 0.5
    expect(q0).toBeCloseTo(0.03, 4); // 0.01
    expect(q4).toBeCloseTo(0.03, 4); // 0.02
    expect(q2).toBeCloseTo(0.5, 4); // 0.5
  });

  it('모두 NaN → 모두 NaN', () => {
    const q = bhFdr([NaN, NaN, NaN]);
    expect(q.every((v) => Number.isNaN(v))).toBe(true);
  });
});
