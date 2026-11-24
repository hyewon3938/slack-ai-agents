/**
 * 2×2 분할표·일자 시퀀스·판정 순수 계산 (pattern-verification에서 분리).
 */

import { cumulativePosteriorFromHitMiss, posteriorMean } from '../bayesian-posterior.js';
import { INSIGHT_THRESHOLDS } from '../insight-thresholds.js';
import { type DayObservation, fisherExact } from '../stats.js';
import type {
  Contingency,
  ContingencyVerification,
  DaySeries,
  LinkLifecycleStatus,
  Verdict,
} from './types.js';

const V = INSIGHT_THRESHOLDS.patternVerification;
/**
 * 시드 활성 시리즈 × 신호 시리즈 → 2×2 (신호 측정불가일은 inconclusive로 분리).
 * windowStart(#504): 데이터-존재 구간 시작 — 이전 날은 빈 과거라 2×2에서 제외(아티팩트 차단).
 */
export const buildContingency = (
  activation: Map<string, boolean>,
  signalSeries: DaySeries,
  windowStart: string | null = null,
): Contingency => {
  let a = 0;
  let b = 0;
  let c = 0;
  let d = 0;
  let inconclusive = 0;
  for (const [date, active] of activation) {
    if (windowStart !== null && date < windowStart) continue; // 데이터-존재 윈도우 밖(빈 과거)
    const pass = signalSeries.get(date);
    if (pass === undefined) continue; // 윈도우 밖(이론상 없음)
    if (pass === null) {
      if (active) inconclusive++;
      continue;
    }
    if (active) {
      if (pass) a++;
      else b++;
    } else if (pass) c++;
    else d++;
  }
  return { a, b, c, d, inconclusive };
};

/**
 * 시드 활성 × 신호 시리즈 → 일자 오름차순 (active, pass) 시퀀스 — e-value 마틴게일 입력(P3).
 * 측정불가일(pass=null)은 제외. windowDates 순서로 순회해 결정론 리플레이 불변 보장(ADR-0034).
 */
export const buildDaySequence = (
  activation: Map<string, boolean>,
  signalSeries: DaySeries,
  windowDates: string[],
  windowStart: string | null = null,
): DayObservation[] => {
  const seq: DayObservation[] = [];
  for (const date of windowDates) {
    if (windowStart !== null && date < windowStart) continue; // 데이터-존재 윈도우 밖(빈 과거) — #504
    const pass = signalSeries.get(date);
    if (pass === null || pass === undefined) continue;
    seq.push({ active: activation.get(date) ?? false, pass });
  }
  return seq;
};

/**
 * daySeq 전·후반 효과 부호(발현일 pass율 − 비발현일 pass율) 일치 여부 — 비정상성/단일국면 의존 표시 플래그
 * (#523 P1, §2-6). 게이트 아님(노출용 stability). 각 반에 발현·비발현 양쪽 관측이 있어야 부호 산출 가능 —
 * 한쪽이라도 결측이면 null(판정 보류). 길이 < minPerHalf*2 면 null. 입력 순서 고정 = SET 리플레이 불변(ADR-0034).
 */
export const splitHalvesConsistent = (
  daySeq: ReadonlyArray<DayObservation>,
  minPerHalf = 4,
): boolean | null => {
  if (daySeq.length < minPerHalf * 2) return null;
  const mid = Math.floor(daySeq.length / 2);
  const effectSign = (seq: ReadonlyArray<DayObservation>): number | null => {
    let a = 0;
    let b = 0;
    let c = 0;
    let d = 0;
    for (const o of seq) {
      if (o.active) {
        if (o.pass) a++;
        else b++;
      } else if (o.pass) c++;
      else d++;
    }
    if (a + b === 0 || c + d === 0) return null; // 한쪽 결측 → 부호 산출 불가
    return Math.sign(a / (a + b) - c / (c + d));
  };
  const s1 = effectSign(daySeq.slice(0, mid));
  const s2 = effectSign(daySeq.slice(mid));
  if (s1 === null || s2 === null) return null;
  return s1 === s2;
};

/** 2×2 → Fisher p + rate ratio + Beta-Binomial posterior. */
export const verifyContingency = (cont: Contingency): ContingencyVerification => {
  const nActive = cont.a + cont.b;
  const nOff = cont.c + cont.d;
  const p = nActive > 0 && nOff > 0 ? fisherExact(cont.a, cont.b, cont.c, cont.d) : NaN;
  const rateActive = nActive > 0 ? cont.a / nActive : NaN;
  const rateOff = nOff > 0 ? cont.c / nOff : NaN;
  const effect =
    Number.isFinite(rateActive) && Number.isFinite(rateOff) && rateOff > 0
      ? rateActive / rateOff
      : NaN;
  const { alpha, beta } = cumulativePosteriorFromHitMiss(cont.a, cont.b);
  return {
    p,
    effect,
    rateActive,
    rateOff,
    posteriorAlpha: alpha,
    posteriorBeta: beta,
    posteriorP: posteriorMean(alpha, beta),
    nActive,
    nOff,
  };
};

/**
 * verdict 분류 (provisional). confirm은 P3 e-value 전까지 승격 안 함(statusForVerdict 참조).
 *   confirm:            nActive≥MIN & q≤CONFIRM_Q & effect≥MIN_RATE_RATIO
 *   direction_mismatch: nActive≥MIN & effect≤DIRECTION_MISMATCH_MAX (명확한 역방향 — #555)
 *   reject:             nActive≥MIN & effect∈[REJECT_LOW, REJECT_HIGH] (연관 없음)
 *   insufficient:       nActive<MIN 또는 effect 산출 불가(off일 0)
 *   inconclusive:       그 외(데이터는 충분하나 판정 보류)
 *
 * direction_mismatch는 reject 밴드보다 먼저 판정한다(#555). 게이트(≤0.77)와 reject 밴드(0.95~1.05)는
 * 겹치지 않지만, 역방향은 "무연관"이 아니라 "반대 방향 신호"이므로 사유를 분리해 종결한다.
 */
export const classifyVerdict = (
  v: Pick<ContingencyVerification, 'nActive' | 'effect'>,
  q: number,
): Verdict => {
  if (v.nActive < V.minActiveDays || !Number.isFinite(v.effect)) return 'insufficient';
  if (Number.isFinite(q) && q <= V.confirmQ && v.effect >= V.minRateRatio) return 'confirm';
  if (v.effect <= V.directionMismatchMaxEffect) return 'direction_mismatch';
  if (v.effect >= V.rejectRatioLow && v.effect <= V.rejectRatioHigh) return 'reject';
  return 'inconclusive';
};

/**
 * P3 status 전이 정책 (ADR-0034 e-value 게이트). verified tier = status='confirmed'.
 *   - reject·direction_mismatch(충분한 데이터의 종결) → 'rejected' (정당한 제거).
 *     둘 다 rejected lifecycle이지만 사유는 test_detail.verdict로 구분(별도 status enum·DB CHECK 불변, #555).
 *   - confirm & e_value ≥ 1/α(=20) → 'confirmed' (verified tier 승격). optional stopping 안전.
 *   - 그 외(confirm이나 e<20, inconclusive, insufficient) → 'active' 유지(emerging은 view가 분류).
 *   - confirmed는 sticky — verifyUserLinks가 active만 재검증하므로 한번 승격되면 동결(금딱지).
 *   - pending/archived 등 non-active는 엔진이 건드리지 않음.
 */
export const statusForVerdict = (
  verdict: Verdict,
  current: LinkLifecycleStatus,
  eValue: number,
): LinkLifecycleStatus => {
  if (current !== 'active') return current;
  if (verdict === 'reject' || verdict === 'direction_mismatch') return 'rejected';
  if (verdict === 'confirm' && eValue >= V.evalueThreshold) return 'confirmed';
  return 'active';
};
