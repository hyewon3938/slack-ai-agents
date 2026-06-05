import { describe, it, expect } from 'vitest';
import {
  fisherExact,
  bhFdr,
  evalueTestMartingale,
  DEFAULT_EVALUE_OPTIONS,
  mannWhitneyU,
  hodgesLehmann,
  blockPermutationP,
  type DayObservation,
} from '../stats.js';

// 결정론 PRNG (mulberry32) — 시뮬 테스트 재현성 보장(고정 seed → flaky 없음).
const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

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

// ─── evalueTestMartingale (P3 빌드 게이트, ADR-0034) ──────

/** 무관 스트림 생성: 매일 active~Bernoulli(activeProb), pass~Bernoulli(p) (active와 독립). */
const buildNullStream = (
  rng: () => number,
  days: number,
  p: number,
  activeProb: number,
): DayObservation[] => {
  const seq: DayObservation[] = [];
  for (let i = 0; i < days; i++) {
    seq.push({ active: rng() < activeProb, pass: rng() < p });
  }
  return seq;
};

describe('evalueTestMartingale — null 시뮬 (빌드 게이트)', () => {
  // ★ 통과 못 하면 머지 금지(ADR-0034 §3). 무관 데이터에서 거짓 확정율(P(sup e ≥ 20)) ≤ α(=0.05).
  // Ville 부등식의 실측 검증 — e-value 정확성의 유일한 보증.
  const ALPHA = 0.05;
  const THRESHOLD = 1 / ALPHA; // 20
  const DAYS = 365;
  const TRIALS = 1500;
  const grid: Array<{ p: number; activeProb: number }> = [];
  for (const p of [0.3, 0.5, 0.7, 0.85]) {
    for (const activeProb of [0.2, 0.4]) grid.push({ p, activeProb });
  }

  it.each(grid)(
    '무관 스트림 p=$p activeProb=$activeProb → 거짓 확정율 ≤ α',
    ({ p, activeProb }) => {
      // seed를 셀별로 고정 → 결정론. 같은 셀은 항상 같은 결과(flaky 0).
      const rng = mulberry32(Math.round((p * 100 + activeProb * 10) * 1000) + 7);
      let falseConfirms = 0;
      for (let t = 0; t < TRIALS; t++) {
        const seq = buildNullStream(rng, DAYS, p, activeProb);
        if (evalueTestMartingale(seq) >= THRESHOLD) falseConfirms++;
      }
      const rate = falseConfirms / TRIALS;
      expect(rate).toBeLessThanOrEqual(ALPHA);
    },
  );

  // 자기상관 robustness — 현실 데이터는 pass가 streak(자기상관)을 갖는다. AR(1) ρ=0.8(강한 streak)
  // pass + active 독립 null에서도 거짓 확정율 ≤ α 유지(편향 방어 회귀 가드). 풀링 r이 핵심.
  it('AR(1) ρ=0.8 자기상관 pass(active 독립) → 거짓 확정율 ≤ α', () => {
    const rng = mulberry32(20260605);
    const rho = 0.8;
    const base = 0.5;
    let falseConfirms = 0;
    for (let t = 0; t < TRIALS; t++) {
      const seq: DayObservation[] = [];
      let prev = rng() < base ? 1 : 0;
      for (let i = 0; i < DAYS; i++) {
        const pPass = base * (1 - rho) + rho * prev;
        const pass = rng() < pPass ? 1 : 0;
        prev = pass;
        seq.push({ active: rng() < 0.4, pass: pass === 1 });
      }
      if (evalueTestMartingale(seq) >= THRESHOLD) falseConfirms++;
    }
    expect(falseConfirms / TRIALS).toBeLessThanOrEqual(ALPHA);
  });
});

describe('evalueTestMartingale — power / 동작', () => {
  it('강한 연관(active pass 0.85 vs off 0.2) → sup e가 20 돌파', () => {
    const rng = mulberry32(42);
    // 충분한 발현일을 쌓는 시퀀스(활성 40%, 1년)
    const seq: DayObservation[] = [];
    for (let i = 0; i < 365; i++) {
      const active = rng() < 0.4;
      const pass = active ? rng() < 0.85 : rng() < 0.2;
      seq.push({ active, pass });
    }
    expect(evalueTestMartingale(seq)).toBeGreaterThanOrEqual(20);
  });

  it('빈 시퀀스 → e=1 (확정 아님)', () => {
    expect(evalueTestMartingale([])).toBe(1);
  });

  it('off-day만 있으면 베팅 없음 → e=1', () => {
    const seq: DayObservation[] = Array.from({ length: 50 }, () => ({
      active: false,
      pass: true,
    }));
    expect(evalueTestMartingale(seq)).toBe(1);
  });

  it('결정론 — 같은 시퀀스는 항상 같은 값 (리플레이 불변)', () => {
    const seq: DayObservation[] = [
      { active: true, pass: true },
      { active: false, pass: false },
      { active: true, pass: true },
      { active: true, pass: false },
      { active: false, pass: true },
    ];
    expect(evalueTestMartingale(seq)).toBe(evalueTestMartingale(seq));
  });

  it('prefix 단조성 — 더 긴 prefix의 sup ≥ 짧은 prefix의 sup', () => {
    const rng = mulberry32(99);
    const full: DayObservation[] = [];
    for (let i = 0; i < 120; i++) {
      const active = rng() < 0.4;
      const pass = active ? rng() < 0.7 : rng() < 0.3;
      full.push({ active, pass });
    }
    const short = full.slice(0, 60);
    expect(evalueTestMartingale(full, DEFAULT_EVALUE_OPTIONS)).toBeGreaterThanOrEqual(
      evalueTestMartingale(short, DEFAULT_EVALUE_OPTIONS),
    );
  });
});

// ─── mannWhitneyU + hodgesLehmann (P3) ───────────────────

describe('mannWhitneyU', () => {
  it('빈 그룹 → NaN', () => {
    const r = mannWhitneyU([], [1, 2]);
    expect(Number.isNaN(r.u)).toBe(true);
    expect(Number.isNaN(r.p)).toBe(true);
  });

  it('완전 분리(a 전부 > b 전부) → 작은 p, U=na*nb', () => {
    const r = mannWhitneyU([10, 11, 12, 13], [1, 2, 3, 4]);
    expect(r.u).toBe(16); // 4*4
    expect(r.p).toBeLessThan(0.05);
    expect(r.z).toBeGreaterThan(0);
  });

  it('동일 분포 → U≈na*nb/2, p 큼', () => {
    const r = mannWhitneyU([1, 2, 3, 4, 5], [1, 2, 3, 4, 5]);
    expect(r.u).toBeCloseTo(12.5, 6); // 25/2
    expect(r.p).toBeGreaterThan(0.9);
  });

  it('tie 보정 — 겹치는 값에서 평균 순위', () => {
    const r = mannWhitneyU([2, 2, 3], [1, 2, 2]);
    expect(Number.isFinite(r.p)).toBe(true);
    expect(r.p).toBeGreaterThan(0);
    expect(r.p).toBeLessThanOrEqual(1);
  });
});

describe('hodgesLehmann', () => {
  it('양 그룹 차이 중앙값', () => {
    // a-b 쌍별 차: a=[5,7], b=[1,2] → 4,3,6,5 → 정렬 3,4,5,6 → median 4.5
    expect(hodgesLehmann([5, 7], [1, 2])).toBeCloseTo(4.5, 6);
  });

  it('동일 그룹 → 0 근방', () => {
    expect(hodgesLehmann([3, 3, 3], [3, 3, 3])).toBe(0);
  });

  it('빈 그룹 → NaN', () => {
    expect(Number.isNaN(hodgesLehmann([], [1]))).toBe(true);
  });
});

// ─── blockPermutationP (P3) ──────────────────────────────

describe('blockPermutationP', () => {
  it('빈/대조불가 시퀀스 → NaN', () => {
    expect(Number.isNaN(blockPermutationP([], 7, 200))).toBe(true);
    // off-day 없음 → rateDiff NaN
    const allActive: DayObservation[] = Array.from({ length: 10 }, () => ({
      active: true,
      pass: true,
    }));
    expect(Number.isNaN(blockPermutationP(allActive, 7, 200))).toBe(true);
  });

  it('강한 연관 → 작은 p (발현일 pass율↑이 셔플보다 극단)', () => {
    const rng = mulberry32(7);
    const seq: DayObservation[] = [];
    for (let i = 0; i < 200; i++) {
      const active = rng() < 0.5;
      const pass = active ? rng() < 0.85 : rng() < 0.15;
      seq.push({ active, pass });
    }
    expect(blockPermutationP(seq, 7, 1000)).toBeLessThan(0.05);
  });

  it('무관 → p가 작지 않음(>0.05 기대) + 결정론(같은 seed)', () => {
    const rng = mulberry32(123);
    const seq: DayObservation[] = [];
    for (let i = 0; i < 200; i++) {
      seq.push({ active: rng() < 0.4, pass: rng() < 0.5 });
    }
    const p1 = blockPermutationP(seq, 7, 1000);
    const p2 = blockPermutationP(seq, 7, 1000);
    expect(p1).toBe(p2); // 결정론(고정 seed)
    expect(p1).toBeGreaterThan(0.05);
  });
});
