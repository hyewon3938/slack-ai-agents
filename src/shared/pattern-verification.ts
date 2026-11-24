/**
 * off-day 대조 검증 엔진 코어 — #477 P2 (ADR-0032 통계 스택 + ADR-0033 매트릭=가설).
 *
 * (시드 × 신호) = pattern_links 를 off-day 대조로 검증한다:
 *   발현일(트리거 fire) vs 비발현일에서 신호 pass율을 2×2로 비교 → Fisher + BH-FDR + Beta-Binomial.
 *   "본인 패턴"과 "그냥 base rate가 높은 신호(기분탓)"를 분리하는 게 핵심(헌장 ②).
 *
 * P1 신호 전역화의 payoff: 신호별 일자 시리즈를 **신호당 1회**, 시드별 활성 시리즈를 **시드당 1회**
 * 계산하고, 링크는 그 위 조인 + 2×2 → O(신호 + 시드)로 환원(옛 per-link 재계산 대비).
 *
 * P3(ADR-0034): 확정 게이트 = 누적 e-value(순차 anytime-valid). q는 screening, e≥1/α(=20)이
 * 'confirmed' 승격(verified tier). 일자 순서가 필요해 2×2 collapse 외에 day 시퀀스도 만든다.
 * 본 모듈은 순수 계산 + 읽기만. UPDATE pattern_links·Slack 발송은 weekly-verification.ts.
 */

// 구현은 ./pattern/ 아래 역할별 파일에 있다. 이 파일은 기존 import 경로를 유지하는 재수출 전용이다.

export type {
  SignalDirection,
  LinkLifecycleStatus,
  Verdict,
  DaySeries,
  SignalDef,
  Contingency,
  ContingencyVerification,
  LinkVerification,
} from './pattern/types.js';
export {
  type UserDataStarts,
  computeUserDataStarts,
  signalDataStart,
  seedDataStart,
  maxDate,
  enrollmentStart,
} from './pattern/data-window.js';
export { buildWindowDates, binarizeSqlSeries } from './pattern/binarize.js';
export {
  buildContingency,
  buildDaySequence,
  splitHalvesConsistent,
  verifyContingency,
  classifyVerdict,
  statusForVerdict,
} from './pattern/contingency.js';
export {
  type MirrorSignalOutcome,
  type MirrorSignalResult,
  ensureMirrorSignalDef,
} from './pattern/mirror-signal.js';
export { type FdrFamily, familyOf, bhFdrByFamily } from './pattern/fdr-family.js';
export {
  type SignalSeriesResult,
  computeSignalSeries,
  splitRawByActivation,
  computeTargetStrengthSeries,
  computeSeedActivationSeries,
} from './pattern/series.js';
export { loadSignalDefsByIds } from './pattern/load-signal-defs.js';
export { verifyUserLinks } from './pattern/verify-links.js';
export { type StrengthCutpoint, computeStrengthCutpoints } from './pattern/strength-cutpoints.js';
