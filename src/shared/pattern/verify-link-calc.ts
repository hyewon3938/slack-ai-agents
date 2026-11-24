/**
 * 링크 1건 검증 계산과 일괄 보정 (verify-links에서 분리, DB 접근 없음).
 */

import {
  type BetaPosterior,
  cumulativePosteriorFromHitMiss,
  empiricalBetaPrior,
  posteriorMean,
} from './bayesian-posterior.js';
import { seedLabel } from '../insight-labels.js';
import { INSIGHT_THRESHOLDS } from '../insight-thresholds.js';
import { type MannWhitneyResult, blockPermutationP, mannWhitneyU } from './stats.js';
import { evalueTestMartingale } from './stats-evalue.js';
import {
  buildContingency,
  buildDaySequence,
  classifyVerdict,
  splitHalvesConsistent,
  statusForVerdict,
  verifyContingency,
} from './contingency.js';
import { type UserDataStarts, enrollmentStart, maxDate, seedDataStart } from './data-window.js';
import { type FdrFamily, bhFdrByFamily, familyOf } from './fdr-family.js';
import type { SajuSeedWithMetrics } from './match-types.js';
import { type SignalSeriesResult, lastActivationDate, splitRawByActivation } from './series.js';
import type {
  Contingency,
  ContingencyVerification,
  LinkLifecycleStatus,
  LinkVerification,
  SignalDef,
} from './types.js';

const V = INSIGHT_THRESHOLDS.patternVerification;

export interface ActiveLinkRow {
  link_id: number;
  seed_id: number;
  signal_id: number;
  status: LinkLifecycleStatus;
  source: string;
  created_date: string | null;
}

/** 링크별 중간 계산 결과 — BH-FDR·empirical-Bayes prior 일괄 적용 전 단계. */
interface LinkInterim {
  row: ActiveLinkRow;
  signal: SignalDef;
  seed: SajuSeedWithMetrics;
  cont: Contingency;
  windowStart: string | null;
  family: FdrFamily;
  v: ContingencyVerification;
  blockP: number;
  mannWhitney: MannWhitneyResult | null;
  eValue: number;
  stability: boolean | null;
  lastMatchedAt: string | null;
}

/** buildLinkInterim이 읽는 사전 계산 맵 묶음. */
export interface LinkInterimDeps {
  signalById: Map<number, SignalDef>;
  seedById: Map<number, SajuSeedWithMetrics>;
  seedSeriesById: Map<number, Map<string, boolean>>;
  signalSeriesById: Map<number, SignalSeriesResult>;
  signalStartById: Map<number, string | null>;
  dataStarts: UserDataStarts;
  windowDates: string[];
}

// 연속 신호만 Mann-Whitney(보고용). raw 분리 → U/p/Hodges-Lehmann.
const computeLinkMannWhitney = (
  signal: SignalDef,
  signalSeries: SignalSeriesResult,
  activation: Map<string, boolean>,
  windowDates: string[],
  windowStart: string | null,
): MannWhitneyResult | null => {
  let mannWhitney: MannWhitneyResult | null = null;
  if (signal.valueType === 'continuous' && signalSeries.raw) {
    const split = splitRawByActivation(activation, signalSeries.raw, windowDates, windowStart);
    if (split.active.length > 0 && split.off.length > 0) {
      mannWhitney = mannWhitneyU(split.active, split.off);
    }
  }
  return mannWhitney;
};

/** 링크 1건의 2×2(Fisher) + block permutation p + e-value + 연속 MW. 시리즈 누락이면 null. */
export const buildLinkInterim = (row: ActiveLinkRow, deps: LinkInterimDeps): LinkInterim | null => {
  const { signalById, seedById, seedSeriesById, signalSeriesById } = deps;
  const { signalStartById, dataStarts, windowDates } = deps;
  const signal = signalById.get(row.signal_id);
  const seed = seedById.get(row.seed_id);
  const activation = seedSeriesById.get(row.seed_id);
  const signalSeries = signalSeriesById.get(row.signal_id);
  if (!signal || !seed || !activation || !signalSeries) return null;
  const series = signalSeries.series;
  // 데이터-존재 윈도우(#504) + enrollment 클립(#523 P0, D1): 셋의 max로 합성.
  // ① 시드 데이터-존재 시작 ② 신호 데이터-존재 시작 ③ 발굴/제안 링크의 등록 익일.
  const windowStart = maxDate(
    maxDate(seedDataStart(seed, dataStarts), signalStartById.get(row.signal_id) ?? null),
    enrollmentStart(row.source, row.created_date),
  );
  const cont = buildContingency(activation, series, windowStart);
  const daySeq = buildDaySequence(activation, series, windowDates, windowStart);
  const mannWhitney = computeLinkMannWhitney(
    signal,
    signalSeries,
    activation,
    windowDates,
    windowStart,
  );
  return {
    row,
    signal,
    seed,
    cont,
    windowStart,
    family: familyOf(seed),
    v: verifyContingency(cont),
    blockP: blockPermutationP(daySeq, V.blockLen, V.blockPermIters),
    mannWhitney,
    eValue: evalueTestMartingale(daySeq),
    stability: splitHalvesConsistent(daySeq),
    lastMatchedAt: lastActivationDate(activation),
  };
};

/** 중간 결과 + 일괄 보정값(q·공통 prior) → 최종 LinkVerification. */
const toLinkVerification = (
  x: LinkInterim,
  qValue: number,
  ebPrior: BetaPosterior,
  signalLabelById: Map<number, string>,
): LinkVerification => {
  const verdict = classifyVerdict(x.v, qValue);
  const post = cumulativePosteriorFromHitMiss(x.cont.a, x.cont.b, ebPrior);
  return {
    linkId: x.row.link_id,
    seedId: x.row.seed_id,
    signalId: x.row.signal_id,
    seedName: x.seed.name,
    seedLabel: seedLabel({ name: x.seed.name, description: x.seed.description }),
    patternKind: x.seed.trigger_target_type === 'life_signal' ? 'life_signal' : 'saju',
    signalName: x.signal.name,
    signalLabel: signalLabelById.get(x.row.signal_id) ?? x.signal.name,
    signalKind: x.signal.kind,
    valueType: x.signal.valueType,
    currentStatus: x.row.status,
    a: x.cont.a,
    b: x.cont.b,
    c: x.cont.c,
    d: x.cont.d,
    inconclusive: x.cont.inconclusive,
    nActive: x.v.nActive,
    nOff: x.v.nOff,
    rateActive: x.v.rateActive,
    rateOff: x.v.rateOff,
    effect: x.v.effect,
    pValue: x.blockP,
    fisherP: x.v.p,
    qValue,
    mannWhitney: x.mannWhitney,
    posteriorAlpha: post.alpha,
    posteriorBeta: post.beta,
    posteriorP: posteriorMean(post.alpha, post.beta),
    eValue: x.eValue,
    lastMatchedAt: x.lastMatchedAt,
    windowStart: x.windowStart,
    family: x.family,
    stability: x.stability,
    verdict,
    nextStatus: statusForVerdict(verdict, x.row.status, x.eValue),
  };
};

/** 전 링크 중간 결과에 공통 prior·가족별 q를 일괄 적용해 최종 결과로 변환. */
export const finalizeVerifications = (
  interim: LinkInterim[],
  signalLabelById: Map<number, string>,
): LinkVerification[] => {
  // empirical-Bayes 공통 prior — 전 링크 발현일 hit/miss로 추정(헌장 ④: 링크 적으면 약함).
  const ebPrior: BetaPosterior = empiricalBetaPrior(
    interim.map((x) => ({ hits: x.cont.a, misses: x.cont.b })),
  );
  // q는 자기상관 보정된 block-perm p로(Fisher는 test_detail 참고용).
  // FDR 가족 분리 (ADR-0037): 강도 밴드(saju_strength)와 baseline을 독립 보정 → 가족 간 비용 격리.
  const qValues = bhFdrByFamily(interim.map((x) => ({ p: x.blockP, family: x.family })));

  return interim.map((x, i) => {
    const qValue = qValues[i] ?? NaN;
    return toLinkVerification(x, qValue, ebPrior, signalLabelById);
  });
};
