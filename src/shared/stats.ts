/**
 * 순수 통계 알고리즘 (의존 없음) — #477 P2·P3 (ADR-0032 통계 스택).
 *
 * - Fisher's exact test (소표본 + 이진 outcome, off-day 2×2 대조) — P2
 * - Benjamini-Hochberg FDR (다중 비교 보정) — P2
 * - e-value test martingale (순차 anytime-valid 확정 게이트, optional stopping 통제) — P3, ADR-0034
 * - block permutation p (자기상관 보정) — P3
 * - Mann-Whitney U + Hodges-Lehmann (연속 신호 보고용) — P3
 * - Mantel-Haenszel 층화 rate ratio (교란 조정) — P7, ADR-0042
 *
 * P1까지 pattern-hypothesis.ts에 있던 pure stats를 추출. DB·도메인 의존 없음 → 단위 테스트 용이.
 */

const logFact = (n: number): number => {
  if (n < 0 || !Number.isFinite(n)) return NaN;
  if (n < 2) return 0;
  let sum = 0;
  for (let i = 2; i <= n; i++) sum += Math.log(i);
  return sum;
};

const logBinom = (n: number, k: number): number => {
  if (k < 0 || k > n) return -Infinity;
  return logFact(n) - logFact(k) - logFact(n - k);
};

const hypergeomLogP = (a: number, b: number, c: number, d: number): number =>
  logBinom(a + b, a) + logBinom(c + d, c) - logBinom(a + b + c + d, a + c);

/**
 * Fisher's exact test (양측). 2x2 분할표 [[a,b],[c,d]].
 * 관찰된 표보다 같거나 더 극단적인 모든 표의 hypergeometric 확률 합.
 */
export const fisherExact = (a: number, b: number, c: number, d: number): number => {
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || !Number.isFinite(d)) {
    return NaN;
  }
  if (a < 0 || b < 0 || c < 0 || d < 0) return NaN;
  const n = a + b + c + d;
  if (n === 0) return 1;

  const row1 = a + b;
  const row2 = c + d;
  const col1 = a + c;
  const obsLogP = hypergeomLogP(a, b, c, d);
  const epsilon = 1e-9;
  const kMin = Math.max(0, col1 - row2);
  const kMax = Math.min(row1, col1);
  let p = 0;
  for (let k = kMin; k <= kMax; k++) {
    const a2 = k;
    const b2 = row1 - k;
    const c2 = col1 - k;
    const d2 = row2 - c2;
    const logP = hypergeomLogP(a2, b2, c2, d2);
    if (logP <= obsLogP + epsilon) {
      p += Math.exp(logP);
    }
  }
  return Math.min(p, 1);
};

/**
 * Benjamini-Hochberg FDR 보정.
 * NaN p-value는 skip 마커로 보고 q도 NaN으로 둠.
 * monotone 보장: q[i] ≤ q[i+1] (정렬 후 역방향 누적 최소).
 */
export const bhFdr = (pValues: number[]): number[] => {
  const valid = pValues.map((p, i) => ({ p, i })).filter((x) => !Number.isNaN(x.p));
  const N = valid.length;
  if (N === 0) return pValues.map(() => NaN);

  valid.sort((a, b) => a.p - b.p);

  const qRaw = valid.map((item, rank) => (item.p * N) / (rank + 1));
  for (let i = qRaw.length - 2; i >= 0; i--) {
    const cur = qRaw[i] ?? Infinity;
    const next = qRaw[i + 1] ?? Infinity;
    qRaw[i] = Math.min(cur, next);
  }

  const result = pValues.map((p) => (Number.isNaN(p) ? NaN : 0));
  valid.forEach((item, sortedIdx) => {
    const q = qRaw[sortedIdx] ?? 1;
    result[item.i] = Math.min(q, 1);
  });
  return result;
};

// ─── e-value test martingale (P3, ADR-0034) ──────────────

/** 일자 순 관측 한 건: active = 시드 발현 여부, pass = 그날 신호 pass 여부(측정불가일은 호출 전 제외). */
export interface DayObservation {
  active: boolean;
  pass: boolean;
}

/**
 * e-value 마틴게일 파라미터 — null 시뮬 빌드 게이트가 type-I ≤ α 를 보증하는 노브(ADR-0034).
 * - bettingFraction: 희석 계수 λ. 매일 베팅을 GRO 최적치의 λ배만 — 추정오차발 type-I 인플레 억제.
 * - priorOff/priorAct: off-day 기준율 r·active alt율 φ 의 Laplace pseudo-count(초기 추정 안정화).
 */
export interface EvalueOptions {
  bettingFraction: number;
  priorOff: number;
  priorAct: number;
}

export const DEFAULT_EVALUE_OPTIONS: EvalueOptions = {
  bettingFraction: 0.5,
  priorOff: 1,
  priorAct: 1,
};

const clampUnit = (x: number, eps = 1e-6): number => Math.min(1 - eps, Math.max(eps, x));

/**
 * 순차 e-value (test martingale)의 누적 supremum 반환 — ADR-0034.
 *
 * 구성: 매 active 일에 "귀무 기준율 r 보다 active pass율이 높다(H1)"에 예측가능(predictable) 베팅.
 *   - r  = 직전까지 *전체 일*(active+off) running pass율 (Laplace prior). H0에서 공통 귀무율 p의
 *          저분산 추정 → Jensen 편향(추정오차발 type-I 인플레)을 off-only 대비 억제. predictable.
 *   - φ  = active-day 까지의 running pass율 (예측가능 대안). φ ≤ r 이면 베팅 안 함(one-sided).
 *   - 희석 대안 φ' = r + λ(φ − r) 로 Bernoulli LR 베팅: pass면 φ'/r, fail이면 (1−φ')/(1−r).
 *     E_H0[log factor] = KL(p‖r) − KL(p‖φ'). r 이 φ' 보다 p 에 가까우면 ≤ 0(안전) — 풀링이 r 을
 *     p 에 붙여 안전쪽으로 민다. 잔여 추정오차는 λ·prior·null 시뮬 빌드 게이트로 통제.
 *
 * 반환 = sup_t E_t. Ville 부등식: H0에서 P(sup_t E_t ≥ 1/α) ≤ α → 임계 1/α(=20, α=0.05)에서 확정.
 * sup 은 시퀀스 prefix 가 자라도 단조 증가 + prequential 추정이 리플레이 불변 → 매주 결정론 재계산 안전.
 */
export const evalueTestMartingale = (
  seq: readonly DayObservation[],
  opts: EvalueOptions = DEFAULT_EVALUE_OPTIONS,
): number => {
  const { bettingFraction: lambda, priorOff, priorAct } = opts;
  let allHits = 0; // 전체 일 누적(귀무 기준율 r용)
  let allN = 0;
  let actHits = 0; // active 일 누적(대안율 φ용)
  let actN = 0;
  let e = 1;
  let peak = 1;

  for (const day of seq) {
    const r = clampUnit((priorOff + allHits) / (2 * priorOff + allN));
    if (day.active) {
      const phi = clampUnit((priorAct + actHits) / (2 * priorAct + actN));
      if (phi > r) {
        const phiDiluted = clampUnit(r + lambda * (phi - r));
        const factor = day.pass ? phiDiluted / r : (1 - phiDiluted) / (1 - r);
        e *= factor;
        if (e > peak) peak = e;
      }
      actHits += day.pass ? 1 : 0;
      actN += 1;
    }
    allHits += day.pass ? 1 : 0;
    allN += 1;
  }
  return peak;
};

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

// ─── Mantel-Haenszel 층화 rate ratio (P7, 교란 조정 — ADR-0042) ──

/**
 * 한 층의 2×2 셀 (Mantel-Haenszel 층화 입력).
 * pattern-verification.Contingency(a,b,c,d,inconclusive)가 구조적으로 호환 → 그대로 넘길 수 있음.
 * 도메인 의존 없이 stats를 순수 유지하려고 최소 셀만 받는다.
 */
export interface Stratum2x2 {
  a: number; // 노출(시드 발현) & 결과+(신호 pass)
  b: number; // 노출 & 결과−
  c: number; // 비노출(시드 비발현) & 결과+
  d: number; // 비노출 & 결과−
}

/**
 * Mantel-Haenszel 조정 rate ratio (Greenland-Robins risk-ratio 추정량) — ADR-0042.
 *
 * 교란 후보 Z로 층(Z-on/Z-off, joint면 값 조합)을 나눠 각 층의 (시드 × 신호) 2×2를 풀링:
 *   RR_MH = Σ_k [ a_k·(c_k+d_k)/n_k ]  /  Σ_k [ c_k·(a_k+b_k)/n_k ]   (n_k = a_k+b_k+c_k+d_k)
 *
 * 층 내 연관만 모아 합산 → 층(=Z) 효과를 통제한 조정 추정치. 무교란(층 동질)이면 marginal RR에 수렴,
 * 완전 교란(층 내 연관 소멸)이면 1로 수렴. n_k=0 층은 기여 없음(skip). 분모 합 0 → NaN(조정 불가).
 * 순수 함수(결정론) → 주간 SET 리플레이 불변.
 */
export const mantelHaenszelRR = (strata: readonly Stratum2x2[]): number => {
  let num = 0;
  let den = 0;
  for (const s of strata) {
    const n = s.a + s.b + s.c + s.d;
    if (n === 0) continue;
    num += (s.a * (s.c + s.d)) / n;
    den += (s.c * (s.a + s.b)) / n;
  }
  if (den === 0) return NaN;
  return num / den;
};
