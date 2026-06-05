/**
 * 순수 통계 알고리즘 (의존 없음) — #477 P2 (ADR-0032 통계 스택).
 *
 * - Fisher's exact test (소표본 + 이진 outcome, off-day 2×2 대조)
 * - Benjamini-Hochberg FDR (다중 비교 보정)
 *
 * P1까지 pattern-hypothesis.ts에 있던 pure stats를 추출. DB·도메인 의존 없음 → 단위 테스트 용이.
 * P3에서 e-value(test martingale)·block permutation·Mann-Whitney가 여기 합류 예정.
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
