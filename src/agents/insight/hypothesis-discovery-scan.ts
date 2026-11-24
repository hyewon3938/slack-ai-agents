/**
 * 패턴 발굴 엔진 스캔 단계 — 여집합 (시드 × 신호) 쌍의 off-day 2×2 + 효과크기 사전선별 (#477 P5a, ADR-0039).
 */

import {
  blockPermutationP,
  mannWhitneyU,
  type MannWhitneyResult,
} from '../../shared/pattern/stats.js';
import { splitRawByActivation, type SignalSeriesResult } from '../../shared/pattern/series.js';
import {
  buildContingency,
  buildDaySequence,
  verifyContingency,
} from '../../shared/pattern/contingency.js';
import { computeUserDataStarts, seedDataStart, maxDate } from '../../shared/pattern/data-window.js';
import {
  type SignalDirection,
  type Contingency,
  type ContingencyVerification,
} from '../../shared/pattern/types.js';
import { type SajuSeedWithMetrics } from '../../shared/pattern/match-types.js';
import { INSIGHT_THRESHOLDS } from '../../shared/insight-thresholds.js';
import { BEHAVIOR_SIGNAL_DOMAIN, type InsightDomain } from '../../shared/insights/types.js';
import type { LoadedSignal } from './hypothesis-discovery-load.js';
import type { Survivor } from './hypothesis-discovery-types.js';

const V = INSIGHT_THRESHOLDS.patternVerification;

/**
 * 행동 시드(life_signal · behavior_baseline)의 source 도메인 (#508 ④, ADR-0046).
 * 사주 시드·캘린더 life_signal(weekday/month_position 등)은 행동 도메인이 없어 null → 필터 면제.
 * 동어반복 필터가 "시드 도메인 == 신호 도메인"(같은 행동 두 번 잼)을 surface 전 거를 때 source.
 */
const behaviorSeedDomain = (seed: {
  trigger_target_type: string;
  trigger_aux: Record<string, unknown> | null;
}): InsightDomain | null => {
  if (seed.trigger_target_type !== 'life_signal') return null;
  const aux = seed.trigger_aux ?? {};
  if (aux['kind'] !== 'behavior_baseline') return null;
  const name = aux['signal_name'];
  return typeof name === 'string'
    ? ((BEHAVIOR_SIGNAL_DOMAIN as Record<string, InsightDomain>)[name] ?? null)
    : null;
};
// ─── §4 효과크기 랭킹 헬퍼 (#504, ADR-0044) ───────────────
// 연속 신호를 이진화 rate ratio로 줄세우면(빈 과거 아티팩트로 0 분모 → 폭증) 헌장 위반.
// 연속은 Mann-Whitney 효과크기로, 정렬은 두 타입을 표준화 z로 통일(SNR — 작은 표본은 z가 작아 robust).

/** direction → +1(높을수록 pass) | -1(낮을수록 pass). 연속 효과크기·z 방향 정렬용. */
const directionSign = (direction: SignalDirection | null): number =>
  direction === 'below_avg' || direction === 'below_abs' ? -1 : 1;

/** rank-biserial 상관 (Mann-Whitney U_active → [-1,1] scale-free 효과크기). */
const rankBiserial = (uActive: number, nActive: number, nOff: number): number =>
  nActive > 0 && nOff > 0 ? (2 * uActive) / (nActive * nOff) - 1 : NaN;

/** 2-proportion z (이진 신호 표준화 효과 — 0 분모 rate-ratio 폭증에 robust, 방향 내장). */
const twoProportionZ = (a: number, b: number, c: number, d: number): number => {
  const nA = a + b;
  const nO = c + d;
  const n = nA + nO;
  if (nA === 0 || nO === 0 || n === 0) return NaN;
  const pHat = (a + c) / n;
  const se = Math.sqrt(pHat * (1 - pHat) * (1 / nA + 1 / nO));
  return se > 0 ? (a / nA - c / nO) / se : NaN;
};

type DataStarts = Awaited<ReturnType<typeof computeUserDataStarts>>;
interface EffectScreen {
  mannWhitney: MannWhitneyResult | null;
  effectSize: number | null;
  sortZ: number;
}

/**
 * 타입별 효과크기 사전선별(§4): 연속=Mann-Whitney 효과크기, 이진=rate ratio + Fisher.
 * 탈락이면 null.
 */
const screenEffect = (
  signal: LoadedSignal,
  sr: SignalSeriesResult,
  activation: Map<string, boolean>,
  cont: Contingency,
  v: ContingencyVerification,
  windowDates: string[],
  windowStart: string | null,
): EffectScreen | null => {
  let mannWhitney: MannWhitneyResult | null = null;
  let effectSize: number | null = null;
  let sortZ: number;
  if (signal.def.valueType === 'continuous' && sr.raw) {
    const split = splitRawByActivation(activation, sr.raw, windowDates, windowStart);
    if (split.active.length === 0 || split.off.length === 0) return null;
    mannWhitney = mannWhitneyU(split.active, split.off);
    const sign = directionSign(signal.def.direction);
    const rb = sign * rankBiserial(mannWhitney.u, split.active.length, split.off.length);
    if (!Number.isFinite(rb) || rb < V.discoveryMinEffectR) return null; // 효과크기 하한(방향 positive)
    if (!Number.isFinite(mannWhitney.p) || mannWhitney.p > V.discoveryMaxFisherP) return null;
    effectSize = mannWhitney.hodgesLehmann;
    sortZ = sign * mannWhitney.z;
  } else {
    if (!Number.isFinite(v.effect) || v.effect < V.discoveryMinEffect) return null;
    if (!Number.isFinite(v.p) || v.p > V.discoveryMaxFisherP) return null;
    sortZ = twoProportionZ(cont.a, cont.b, cont.c, cont.d);
  }
  if (!Number.isFinite(sortZ)) return null;
  return { mannWhitney, effectSize, sortZ };
};

interface ScanInput {
  seeds: SajuSeedWithMetrics[];
  signals: LoadedSignal[];
  linked: Set<string>;
  windowDates: string[];
  dataStarts: DataStarts;
  signalStartById: Map<number, string | null>;
  signalSeriesById: Map<number, SignalSeriesResult>;
  seedActivationById: Map<number, Map<string, boolean>>;
}

/** 여집합 후보 → 데이터-존재 윈도우 클립 → 2×2 → 타입별 효과크기 사전선별 → 통과만 block-perm. */
export const scanSurvivors = ({
  seeds,
  signals,
  linked,
  windowDates,
  dataStarts,
  signalStartById,
  signalSeriesById,
  seedActivationById,
}: ScanInput): { survivors: Survivor[]; droppedSameDomain: number } => {
  const survivors: Survivor[] = [];
  let droppedSameDomain = 0; // #508 ④ — 동어반복(자기상관) 드롭 카운트(무음 캡 금지, 로그로 가시화)
  for (const seed of seeds) {
    const activation = seedActivationById.get(seed.id);
    if (!activation) continue;
    const seedStart = seedDataStart(seed, dataStarts);
    const seedDom = behaviorSeedDomain(seed); // 행동 시드만 non-null(사주·캘린더는 면제)
    for (const signal of signals) {
      if (linked.has(`${seed.id}:${signal.def.id}`)) continue;
      // 동어반복 필터(#508 ④): 같은 행동을 두 번 잰 자기상관 쌍은 사전선별·FDR 전에 제외(풀 오염 방지).
      if (seedDom !== null && seedDom === signal.def.domain) {
        droppedSameDomain += 1;
        continue;
      }
      const sr = signalSeriesById.get(signal.def.id);
      if (!sr) continue;
      const series = sr.series;
      // 그 시드·그 신호가 둘 다 데이터를 가진 구간으로 클립(빈 과거 = COALESCE 0=fail 아티팩트 차단).
      const windowStart = maxDate(seedStart, signalStartById.get(signal.def.id) ?? null);
      const cont = buildContingency(activation, series, windowStart);
      const v = verifyContingency(cont);
      if (v.nActive < V.discoveryMinActive) continue; // 공통: 발현일 충분

      const screen = screenEffect(signal, sr, activation, cont, v, windowDates, windowStart);
      if (!screen) continue;
      const { mannWhitney, effectSize, sortZ } = screen;

      const daySeq = buildDaySequence(activation, series, windowDates, windowStart);
      const blockP = blockPermutationP(daySeq, V.blockLen, V.blockPermIters);
      survivors.push({ seed, signal, cont, v, blockP, mannWhitney, effectSize, sortZ });
    }
  }
  return { survivors, droppedSameDomain };
};
