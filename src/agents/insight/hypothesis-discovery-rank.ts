/**
 * 패턴 발굴 엔진 후보 단계 — 생존 쌍을 카드·pending 링크용 후보로 바꾸고 top-N으로 자른다 (#477 P5a, ADR-0039).
 */

import { familyOf } from '../../shared/pattern/fdr-family.js';
import { INSIGHT_THRESHOLDS } from '../../shared/insight-thresholds.js';
import { seedLabel, signalLabel } from '../../shared/insight-labels.js';
import type { DiscoveryCandidate, Survivor } from './hypothesis-discovery-types.js';

const V = INSIGHT_THRESHOLDS.patternVerification;
/** 생존 쌍 + 발견 q → 카드·pending 링크용 후보. */
export const toDiscoveryCandidate = (s: Survivor, q: number): DiscoveryCandidate => ({
  seedId: s.seed.id,
  signalId: s.signal.def.id,
  seedName: s.seed.name,
  seedDescription: s.seed.description,
  seedLabel: seedLabel({ name: s.seed.name, description: s.seed.description }),
  patternKind: s.seed.trigger_target_type === 'life_signal' ? 'life_signal' : 'saju',
  signalName: s.signal.def.name,
  signalDescription: s.signal.description,
  signalLabel: signalLabel({
    name: s.signal.def.name,
    kind: s.signal.def.kind,
    source: s.signal.def.source,
    direction: s.signal.def.direction,
    threshold: s.signal.def.threshold,
    tagName: s.signal.def.tagName,
    domain: s.signal.def.domain,
    description: s.signal.description,
  }),
  signalKind: s.signal.def.kind,
  valueType: s.signal.def.valueType,
  rateActive: s.v.rateActive,
  rateOff: s.v.rateOff,
  effect: s.v.effect,
  effectSize: s.effectSize,
  mwP: s.mannWhitney ? s.mannWhitney.p : null,
  sortZ: s.sortZ,
  nActive: s.v.nActive,
  hit: s.cont.a,
  miss: s.cont.b,
  inconclusive: s.cont.inconclusive,
  fisherP: s.v.p,
  blockP: s.blockP,
  qValue: q,
  posteriorAlpha: s.v.posteriorAlpha,
  posteriorBeta: s.v.posteriorBeta,
  posteriorP: s.v.posteriorP,
  family: familyOf(s.seed),
});

/**
 * top-N (표준화 z 내림차순 — §4: 연속/이진 공통 SNR 척도, 0 분모 폭증에 robust).
 * 드롭 시 로그 — 무음 캡 금지(ADR-0039 단점).
 */
export const rankTopN = (passed: DiscoveryCandidate[], userId: number): DiscoveryCandidate[] => {
  passed.sort((a, b) => b.sortZ - a.sortZ);
  if (passed.length > V.discoveryTopN) {
    console.warn(
      `[Discovery] user=${userId} 발견 ${passed.length} → top ${V.discoveryTopN} ` +
        `(드롭 ${passed.length - V.discoveryTopN})`,
    );
  }
  return passed.slice(0, V.discoveryTopN);
};
