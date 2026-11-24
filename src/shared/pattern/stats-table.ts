/**
 * 2×2 표 기반 검정과 다중 비교 보정 (stats에서 분리, 순수·의존 없음) — ADR-0032 통계 스택.
 *
 * - Fisher's exact test (소표본 + 이진 outcome, off-day 2×2 대조) — P2
 * - Benjamini-Hochberg FDR (다중 비교 보정) — P2
 * - Mantel-Haenszel 층화 rate ratio (교란 조정) — P7, ADR-0042
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
