/**
 * 사용자 링크 주간 검증 (pattern-verification에서 분리).
 */

import {
  type BetaPosterior,
  cumulativePosteriorFromHitMiss,
  empiricalBetaPrior,
  posteriorMean,
} from '../bayesian-posterior.js';
import { query } from '../db.js';
import { seedLabel, signalLabel } from '../insight-labels.js';
import { INSIGHT_THRESHOLDS } from '../insight-thresholds.js';
import type { BandCuts } from '../quantile.js';
import {
  type MannWhitneyResult,
  blockPermutationP,
  evalueTestMartingale,
  mannWhitneyU,
} from '../stats.js';
import { buildWindowDates } from './binarize.js';
import {
  buildContingency,
  buildDaySequence,
  classifyVerdict,
  splitHalvesConsistent,
  statusForVerdict,
  verifyContingency,
} from './contingency.js';
import {
  computeUserDataStarts,
  enrollmentStart,
  maxDate,
  seedDataStart,
  signalDataStart,
} from './data-window.js';
import { bhFdrByFamily, familyOf } from './fdr-family.js';
import { querySignalDefRows, toSignalDef } from './load-signal-defs.js';
import { buildNameIdMap } from './match-day.js';
import { loadActiveSeeds } from './match-seeds.js';
import type { DailyContext } from './match-types.js';
import {
  type SignalSeriesResult,
  computeSeedActivationSeries,
  computeSignalSeries,
  lastActivationDate,
  splitRawByActivation,
} from './series.js';
import type { LinkLifecycleStatus, LinkVerification } from './types.js';

const V = INSIGHT_THRESHOLDS.patternVerification;
interface ActiveLinkRow {
  link_id: number;
  seed_id: number;
  signal_id: number;
  status: LinkLifecycleStatus;
  source: string;
  created_date: string | null;
}

/**
 * 한 유저의 active 링크 전부를 off-day 대조 검증. UPDATE/Slack 없음 — 계산 결과만 반환.
 * BH-FDR은 전 링크 p를 모아 일괄 적용.
 */
export const verifyUserLinks = async (
  userId: number,
  today: string,
): Promise<LinkVerification[]> => {
  const linkRes = await query<ActiveLinkRow>(
    `SELECT l.id AS link_id, l.seed_id, l.signal_id, l.status,
            l.source, (l.created_at AT TIME ZONE 'Asia/Seoul')::date::text AS created_date
       FROM pattern_links l
       JOIN signal_defs s ON s.id = l.signal_id
       JOIN pattern_catalog c ON c.id = l.seed_id
      WHERE l.user_id = $1 AND l.status = 'active' AND s.status = 'active' AND c.active = true
      ORDER BY l.id`,
    [userId],
  );
  if (linkRes.rows.length === 0) return [];

  const seeds = await loadActiveSeeds(userId);
  const seedById = new Map(seeds.map((s) => [s.id, s]));

  const signalIds = [...new Set(linkRes.rows.map((r) => r.signal_id))];
  const signalRows = await querySignalDefRows(signalIds);
  const signalById = new Map(signalRows.map((r) => [r.id, toSignalDef(r)]));
  // 카드용 신호 라벨 — 룰(seed) / 자작 description(llm). 로드 지점에서 1회 계산해 문자열로 운반.
  const signalLabelById = new Map(
    signalRows.map((r) => [
      r.id,
      signalLabel({
        name: r.name,
        kind: r.kind,
        source: r.source,
        direction: r.direction,
        threshold: r.threshold === null ? null : Number(r.threshold),
        tagName: r.tag_name,
        domain: r.domain,
        description: r.description,
      }),
    ]),
  );

  const windowDates = buildWindowDates(today, V.windowCapDays);
  const [stemMap, branchMap] = await Promise.all([
    buildNameIdMap('stems_master'),
    buildNameIdMap('branches_master'),
  ]);

  // 데이터-존재 윈도우(#504): 신호별·시드별 시작일을 1회 산출 → 링크마다 max로 클립.
  const dataStarts = await computeUserDataStarts(userId);
  const signalStartById = new Map(
    [...signalById].map(([sid, sig]) => [sid, signalDataStart(sig.domain, dataStarts)]),
  );

  // 신호 시리즈(신호당 1회) + 시드 활성 시리즈(시드당 1회) — P1 전역화 payoff.
  // 신호 시리즈는 자기 도메인 시작일 기준으로 빈 과거를 결측 처리(baseline 오염·아티팩트 차단).
  const signalSeriesById = new Map<number, SignalSeriesResult>();
  for (const [sid, signal] of signalById) {
    signalSeriesById.set(
      sid,
      await computeSignalSeries(userId, signal, windowDates, signalStartById.get(sid) ?? null),
    );
  }
  const ctxCache = new Map<string, DailyContext | null>();
  // 강도 시리즈·컷 캐시 — 18 밴드 시드가 6 target(일간+5오행) 계산을 공유(재계산 방지).
  const strengthCache = new Map<string, Map<string, number>>();
  const cutCache = new Map<string, BandCuts>();
  const seedSeriesById = new Map<number, Map<string, boolean>>();
  for (const seedId of new Set(linkRes.rows.map((r) => r.seed_id))) {
    const seed = seedById.get(seedId);
    if (!seed) continue;
    seedSeriesById.set(
      seedId,
      await computeSeedActivationSeries(
        seed,
        userId,
        windowDates,
        ctxCache,
        stemMap,
        branchMap,
        strengthCache,
        cutCache,
      ),
    );
  }

  // 링크별 2×2(Fisher) + block permutation p + e-value + 연속 MW. q는 block-perm p로 일괄 BH-FDR.
  const interim = linkRes.rows
    .map((row) => {
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
      // 연속 신호만 Mann-Whitney(보고용). raw 분리 → U/p/Hodges-Lehmann.
      let mannWhitney: MannWhitneyResult | null = null;
      if (signal.valueType === 'continuous' && signalSeries.raw) {
        const split = splitRawByActivation(activation, signalSeries.raw, windowDates, windowStart);
        if (split.active.length > 0 && split.off.length > 0) {
          mannWhitney = mannWhitneyU(split.active, split.off);
        }
      }
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
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // empirical-Bayes 공통 prior — 전 링크 발현일 hit/miss로 추정(헌장 ④: 링크 적으면 약함).
  const ebPrior: BetaPosterior = empiricalBetaPrior(
    interim.map((x) => ({ hits: x.cont.a, misses: x.cont.b })),
  );
  // q는 자기상관 보정된 block-perm p로(Fisher는 test_detail 참고용).
  // FDR 가족 분리 (ADR-0037): 강도 밴드(saju_strength)와 baseline을 독립 보정 → 가족 간 비용 격리.
  const qValues = bhFdrByFamily(interim.map((x) => ({ p: x.blockP, family: x.family })));

  return interim.map((x, i) => {
    const qValue = qValues[i] ?? NaN;
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
  });
};
