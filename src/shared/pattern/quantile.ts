/**
 * 분위수 컷 + 밴드 분류 순수 함수 — #477 P4a (ADR-0036).
 *
 * 강도 feature를 "내 안에서의 상대 약/적정/강"으로 자르기 위한 tertile 컷.
 * 핵심 불변식: 주간 엔진(윈도우 전체로 컷 산출)과 일별 cron(저장된 컷으로 오늘만 판정)이
 * **동일한 value-vs-cut 규칙**을 써야 결정론 정합이 유지된다(rank 기반 금지 — 일별은 rank 못 냄).
 */

export interface BandCuts {
  /** 하위 분위 컷 — value < low 이면 'low' 밴드 */
  low: number;
  /** 상위 분위 컷 — value ≥ high 이면 'high' 밴드 */
  high: number;
}

export type Band = 'low' | 'mid' | 'high';

const BANDS: readonly Band[] = ['low', 'mid', 'high'];

/** trigger_aux.band을 Band로 좁히는 type guard (잘못된 값은 false). */
export const isBand = (v: unknown): v is Band =>
  typeof v === 'string' && (BANDS as readonly string[]).includes(v);

/**
 * 정렬된 배열에서 선형보간 분위수. q∈[0,1]. (R-7 / numpy 기본과 동일 방식)
 * 빈 배열은 NaN.
 */
export const quantileSorted = (sorted: readonly number[], q: number): number => {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0] ?? NaN;
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const frac = pos - lo;
  const vLo = sorted[lo] ?? NaN;
  const vHi = sorted[hi] ?? NaN;
  return vLo + (vHi - vLo) * frac;
};

/**
 * tertile 컷(1/3, 2/3 분위수) 산출. 입력은 정렬 불요(내부 복사·정렬).
 * divisions=3 기준. 동값 다수 → low==high 로 붕괴 가능(축약 밴드, classifyBand가 흡수).
 */
export const tertileCuts = (values: readonly number[], divisions = 3): BandCuts => {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length === 0) return { low: NaN, high: NaN };
  const sorted = [...clean].sort((a, b) => a - b);
  const lowQ = 1 / divisions;
  const highQ = (divisions - 1) / divisions;
  return { low: quantileSorted(sorted, lowQ), high: quantileSorted(sorted, highQ) };
};

/**
 * value를 컷에 비교해 밴드 분류. 경계 규칙(주간·일별 공통):
 *   value < low      → 'low'
 *   low ≤ value < high → 'mid'
 *   value ≥ high     → 'high'
 * 컷이 NaN(샘플 없음)이면 null(판정 불가 → 발현 없음으로 처리).
 * low==high(동값 붕괴)면 mid가 사라지고 low/high 2밴드로 자연 축약.
 */
export const classifyBand = (value: number, cuts: BandCuts): Band | null => {
  if (!Number.isFinite(value) || !Number.isFinite(cuts.low) || !Number.isFinite(cuts.high)) {
    return null;
  }
  if (value < cuts.low) return 'low';
  if (value >= cuts.high) return 'high';
  return 'mid';
};
