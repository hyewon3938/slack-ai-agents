/**
 * 순수 통계 알고리즘 (의존 없음) — #477 P3 (ADR-0032 통계 스택).
 *
 * - block permutation p (자기상관 보정) — P3
 * - Mann-Whitney U + Hodges-Lehmann (연속 신호 보고용) — P3
 *
 * 2×2 표 검정·BH-FDR·Mantel-Haenszel은 stats-table.ts, e-value martingale은 stats-evalue.ts.
 * DB·도메인 의존 없음 → 단위 테스트 용이.
 */

import type { DayObservation } from './stats-evalue.js';

// ─── 보조: 정규 CDF · 중앙값 · 결정론 PRNG ────────────────

/** erf 근사 (Abramowitz-Stegun 7.1.26, |error| < 1.5e-7). */
const erf = (x: number): number => {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
};

const normalCdf = (x: number): number => 0.5 * (1 + erf(x / Math.SQRT2));

const median = (sorted: number[]): number => {
  const n = sorted.length;
  if (n === 0) return NaN;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? (sorted[mid] ?? NaN) : ((sorted[mid - 1] ?? NaN) + (sorted[mid] ?? NaN)) / 2;
};

/** mulberry32 — 결정론 PRNG. block permutation 재현성(주간 리플레이 불변) 보장. */
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

// ─── Mann-Whitney U + Hodges-Lehmann (P3, 연속 신호 보고용) ──

export interface MannWhitneyResult {
  u: number; // group a(발현일) 기준 U
  p: number; // 양측 정규근사 p (tie 보정)
  z: number;
  hodgesLehmann: number; // a-b 쌍별 차의 중앙값 (효과크기)
}

/**
 * Mann-Whitney U (tie 보정 정규근사) + Hodges-Lehmann 추정량.
 * ADR-0033: 게이트는 이진 유지 — 본 함수는 연속 신호의 보고용 효과크기(test_detail).
 */
export const mannWhitneyU = (a: readonly number[], b: readonly number[]): MannWhitneyResult => {
  const na = a.length;
  const nb = b.length;
  if (na === 0 || nb === 0) return { u: NaN, p: NaN, z: NaN, hodgesLehmann: NaN };

  const combined = [...a.map((v) => ({ v, g: 0 })), ...b.map((v) => ({ v, g: 1 }))].sort(
    (x, y) => x.v - y.v,
  );

  const ranks = new Array<number>(combined.length);
  let tieTerm = 0;
  let i = 0;
  while (i < combined.length) {
    let j = i;
    while (j + 1 < combined.length && combined[j + 1]?.v === combined[i]?.v) j++;
    const avgRank = (i + j) / 2 + 1; // 1-based 평균 순위
    for (let k = i; k <= j; k++) ranks[k] = avgRank;
    const t = j - i + 1;
    if (t > 1) tieTerm += t * t * t - t;
    i = j + 1;
  }

  let rankSumA = 0;
  for (let k = 0; k < combined.length; k++) {
    if (combined[k]?.g === 0) rankSumA += ranks[k] ?? 0;
  }
  const u = rankSumA - (na * (na + 1)) / 2;
  const meanU = (na * nb) / 2;
  const N = na + nb;
  const varU = ((na * nb) / 12) * (N + 1 - tieTerm / (N * (N - 1)));
  const hl = hodgesLehmann(a, b);
  if (varU <= 0) return { u, p: 1, z: 0, hodgesLehmann: hl };
  const z = (u - meanU) / Math.sqrt(varU);
  const p = Math.min(1, 2 * (1 - normalCdf(Math.abs(z))));
  return { u, p, z, hodgesLehmann: hl };
};

/** Hodges-Lehmann: 모든 (a_i − b_j) 쌍별 차의 중앙값. 위치 이동 추정(robust 효과크기). */
export const hodgesLehmann = (a: readonly number[], b: readonly number[]): number => {
  if (a.length === 0 || b.length === 0) return NaN;
  const diffs: number[] = [];
  for (const x of a) for (const y of b) diffs.push(x - y);
  diffs.sort((p, q) => p - q);
  return median(diffs);
};

// ─── block permutation (P3, 자기상관 보정) ───────────────

const rateDiff = (active: readonly boolean[], pass: readonly boolean[]): number => {
  let a = 0;
  let nAct = 0;
  let c = 0;
  let nOff = 0;
  for (let i = 0; i < active.length; i++) {
    if (active[i]) {
      nAct++;
      if (pass[i]) a++;
    } else {
      nOff++;
      if (pass[i]) c++;
    }
  }
  if (nAct === 0 || nOff === 0) return NaN;
  return a / nAct - c / nOff;
};

/** 연속 블록 단위로 셔플(블록 내 자기상관 보존). 길이 n 유지. */
const blockShuffle = (arr: readonly boolean[], blockLen: number, rng: () => number): boolean[] => {
  const blocks: boolean[][] = [];
  for (let i = 0; i < arr.length; i += blockLen) blocks.push(arr.slice(i, i + blockLen));
  for (let i = blocks.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const bi = blocks[i];
    const bj = blocks[j];
    if (bi && bj) {
      blocks[i] = bj;
      blocks[j] = bi;
    }
  }
  return blocks.flat();
};

/**
 * block permutation p (one-sided, 발현일 pass율 상승 방향) — ADR-0032 자기상관 보정.
 * active 라벨을 블록 단위로 셔플(pass·자기상관 고정) → 귀무분포 → p = (1+#{perm≥obs})/(iters+1).
 * Fisher(독립 가정)보다 자기상관(연속 발현 streak) 있을 때 보수적. 결정론(고정 seed) → 리플레이 불변.
 */
export const blockPermutationP = (
  seq: readonly DayObservation[],
  blockLen: number,
  iters: number,
  seed = 0x5eed,
): number => {
  if (seq.length === 0) return NaN;
  const active = seq.map((d) => d.active);
  const pass = seq.map((d) => d.pass);
  const obs = rateDiff(active, pass);
  if (!Number.isFinite(obs)) return NaN;
  const rng = mulberry32(seed);
  let ge = 0;
  for (let it = 0; it < iters; it++) {
    const d = rateDiff(blockShuffle(active, blockLen, rng), pass);
    if (Number.isFinite(d) && d >= obs) ge++;
  }
  return (1 + ge) / (iters + 1);
};
