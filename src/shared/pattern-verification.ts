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

import { query } from './db.js';
import { addDays } from './kst.js';
import {
  fisherExact,
  bhFdr,
  evalueTestMartingale,
  mannWhitneyU,
  blockPermutationP,
  type DayObservation,
  type MannWhitneyResult,
} from './stats.js';
import {
  cumulativePosteriorFromHitMiss,
  empiricalBetaPrior,
  posteriorMean,
  type BetaPosterior,
} from './bayesian-posterior.js';
import {
  evaluateTrigger,
  getDailyContext,
  loadActiveSeeds,
  runMetricSql,
  buildNameIdMap,
  type SajuSeedWithMetrics,
  type DailyContext,
} from './pattern-match.js';
import { INSIGHT_THRESHOLDS } from './insight-thresholds.js';

const V = INSIGHT_THRESHOLDS.patternVerification;

export type SignalDirection =
  | 'above_avg'
  | 'below_avg'
  | 'above_abs'
  | 'below_abs'
  | 'flag_present';

export type LinkLifecycleStatus =
  | 'active'
  | 'pending'
  | 'weak'
  | 'confirmed'
  | 'rejected'
  | 'archived';

export type Verdict = 'confirm' | 'reject' | 'insufficient' | 'inconclusive';

/** 신호 일자 시리즈: pass=true / fail=false / 측정불가=null(2×2에서 제외). */
export type DaySeries = Map<string, boolean | null>;

export interface SignalDef {
  id: number;
  name: string;
  kind: 'sql' | 'tag';
  sqlBody: string | null;
  valueType: 'binary' | 'continuous' | null;
  direction: SignalDirection | null;
  threshold: number | null;
  tagName: string | null;
  windowDays: number | null;
}

export interface Contingency {
  a: number; // 발현 & pass
  b: number; // 발현 & fail
  c: number; // 비발현 & pass
  d: number; // 비발현 & fail
  inconclusive: number; // 발현일인데 신호 측정불가(null)
}

export interface ContingencyVerification {
  p: number;
  effect: number; // rate ratio = (a/(a+b)) / (c/(c+d))
  rateActive: number;
  rateOff: number;
  posteriorAlpha: number;
  posteriorBeta: number;
  posteriorP: number;
  nActive: number;
  nOff: number;
}

export interface LinkVerification {
  linkId: number;
  seedId: number;
  signalId: number;
  seedName: string;
  patternKind: 'saju' | 'life_signal';
  signalName: string;
  signalKind: 'sql' | 'tag';
  valueType: 'binary' | 'continuous' | null;
  currentStatus: LinkLifecycleStatus;
  a: number;
  b: number;
  c: number;
  d: number;
  inconclusive: number;
  nActive: number;
  nOff: number;
  rateActive: number;
  rateOff: number;
  effect: number;
  pValue: number; // block permutation p (자기상관 보정, BH-FDR 입력) — P3
  fisherP: number; // Fisher exact p (참고용 → test_detail)
  qValue: number; // bhFdr(blockP)
  mannWhitney: MannWhitneyResult | null; // 연속 신호 보고용 효과크기 (test_detail) — P3
  posteriorAlpha: number;
  posteriorBeta: number;
  posteriorP: number;
  eValue: number; // 누적 e-value sup (P3, ADR-0034). ≥ evalueThreshold → confirmed.
  lastMatchedAt: string | null;
  verdict: Verdict;
  nextStatus: LinkLifecycleStatus;
}

// ─── 순수 계산 ───────────────────────────────────────────

/** today 포함 [today - cap, today] 오름차순 ISO 일자 배열. */
export const buildWindowDates = (today: string, cap: number): string[] => {
  const dates: string[] = [];
  for (let i = cap; i >= 0; i--) dates.push(addDays(today, -i));
  return dates;
};

/**
 * above_avg/below_avg용 rolling baseline = 직전 windowDays 일의 non-null raw 평균.
 * 워밍업(i < windowDays) 미충족 시 null(2×2에서 제외 → 초기 28일 같은 미성숙 baseline 배제).
 */
const rollingBaseline = (
  rawByDate: Map<string, number | null>,
  windowDates: string[],
  i: number,
  windowDays: number,
): number | null => {
  if (i < windowDays) return null;
  let sum = 0;
  let n = 0;
  for (let j = i - windowDays; j < i; j++) {
    const v = rawByDate.get(windowDates[j] ?? '');
    if (v !== null && v !== undefined) {
      sum += v;
      n++;
    }
  }
  return n > 0 ? sum / n : null;
};

/**
 * sql 신호 raw 값 시리즈를 direction 기준 이진화.
 * above_avg/below_avg는 baseline 이진화(ADR-0032 §3 — e-value 게이트는 이진, 연속은 baseline 이진화).
 * above_abs/below_abs/flag_present는 절대 임계 비교(baseline 불요).
 */
export const binarizeSqlSeries = (
  rawByDate: Map<string, number | null>,
  windowDates: string[],
  direction: SignalDirection,
  threshold: number | null,
  windowDays: number,
): DaySeries => {
  const series: DaySeries = new Map();
  for (let i = 0; i < windowDates.length; i++) {
    const date = windowDates[i] ?? '';
    const v = rawByDate.get(date);
    if (v === null || v === undefined) {
      series.set(date, null);
      continue;
    }
    switch (direction) {
      case 'above_abs':
        series.set(date, v >= (threshold ?? 1));
        break;
      case 'below_abs':
        series.set(date, v <= (threshold ?? 0));
        break;
      case 'flag_present':
        series.set(date, v >= (threshold ?? 1));
        break;
      case 'above_avg':
      case 'below_avg': {
        const base = rollingBaseline(rawByDate, windowDates, i, windowDays);
        if (base === null) {
          series.set(date, null);
          break;
        }
        series.set(date, direction === 'above_avg' ? v > base : v < base);
        break;
      }
    }
  }
  return series;
};

/** 시드 활성 시리즈 × 신호 시리즈 → 2×2 (신호 측정불가일은 inconclusive로 분리). */
export const buildContingency = (
  activation: Map<string, boolean>,
  signalSeries: DaySeries,
): Contingency => {
  let a = 0;
  let b = 0;
  let c = 0;
  let d = 0;
  let inconclusive = 0;
  for (const [date, active] of activation) {
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
): DayObservation[] => {
  const seq: DayObservation[] = [];
  for (const date of windowDates) {
    const pass = signalSeries.get(date);
    if (pass === null || pass === undefined) continue;
    seq.push({ active: activation.get(date) ?? false, pass });
  }
  return seq;
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
 *   confirm:      nActive≥MIN & q≤CONFIRM_Q & effect≥MIN_RATE_RATIO
 *   reject:       nActive≥MIN & effect∈[REJECT_LOW, REJECT_HIGH] (연관 없음)
 *   insufficient: nActive<MIN 또는 effect 산출 불가(off일 0)
 *   inconclusive: 그 외(데이터는 충분하나 판정 보류)
 */
export const classifyVerdict = (
  v: Pick<ContingencyVerification, 'nActive' | 'effect'>,
  q: number,
): Verdict => {
  if (v.nActive < V.minActiveDays || !Number.isFinite(v.effect)) return 'insufficient';
  if (Number.isFinite(q) && q <= V.confirmQ && v.effect >= V.minRateRatio) return 'confirm';
  if (v.effect >= V.rejectRatioLow && v.effect <= V.rejectRatioHigh) return 'reject';
  return 'inconclusive';
};

/**
 * P3 status 전이 정책 (ADR-0034 e-value 게이트). verified tier = status='confirmed'.
 *   - reject(반증, 충분한 데이터) → 'rejected' (정당한 제거).
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
  if (verdict === 'reject') return 'rejected';
  if (verdict === 'confirm' && eValue >= V.evalueThreshold) return 'confirmed';
  return 'active';
};

// ─── 읽기 (시리즈 계산) ──────────────────────────────────

/** 신호 시리즈 결과. raw는 sql continuous 신호일 때만 non-null(Mann-Whitney 보고용). */
export interface SignalSeriesResult {
  series: DaySeries;
  raw: Map<string, number | null> | null;
}

/** 신호 일자 시리즈 (신호당 1회). tag=태그 존재 여부, sql=raw 시리즈 → binarize(+continuous는 raw 보존). */
export const computeSignalSeries = async (
  userId: number,
  signal: SignalDef,
  windowDates: string[],
): Promise<SignalSeriesResult> => {
  if (windowDates.length === 0) return { series: new Map(), raw: null };
  if (signal.kind === 'tag') {
    if (!signal.tagName) return { series: new Map(windowDates.map((d) => [d, false])), raw: null };
    const res = await query<{ date: string }>(
      `SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date
         FROM diary_meta_tags
        WHERE user_id = $1 AND tag = $2 AND date >= $3 AND date <= $4`,
      [userId, signal.tagName, windowDates[0], windowDates[windowDates.length - 1]],
    );
    const present = new Set(res.rows.map((r) => r.date));
    return { series: new Map(windowDates.map((d) => [d, present.has(d)])), raw: null };
  }
  // kind === 'sql'
  if (!signal.sqlBody || !signal.direction) {
    return { series: new Map(windowDates.map((d) => [d, null])), raw: null };
  }
  const raw = new Map<string, number | null>();
  for (const d of windowDates) {
    try {
      raw.set(d, await runMetricSql(signal.sqlBody, userId, d));
    } catch {
      raw.set(d, null);
    }
  }
  const series = binarizeSqlSeries(
    raw,
    windowDates,
    signal.direction,
    signal.threshold,
    signal.windowDays ?? V.baselineWindowDays,
  );
  // continuous 신호만 raw 보존(MW). binary(flag_present 등)는 raw 불필요.
  return { series, raw: signal.valueType === 'continuous' ? raw : null };
};

/** 연속 신호 raw를 발현/비발현으로 분리 (Mann-Whitney 입력). 측정불가(null)일 제외. */
export const splitRawByActivation = (
  activation: Map<string, boolean>,
  raw: Map<string, number | null>,
  windowDates: string[],
): { active: number[]; off: number[] } => {
  const active: number[] = [];
  const off: number[] = [];
  for (const date of windowDates) {
    const v = raw.get(date);
    if (v === null || v === undefined) continue;
    if (activation.get(date)) active.push(v);
    else off.push(v);
  }
  return { active, off };
};

/** 시드 활성 시리즈 (시드당 1회). 일자별 getDailyContext(캐시) → evaluateTrigger. */
export const computeSeedActivationSeries = async (
  seed: SajuSeedWithMetrics,
  userId: number,
  windowDates: string[],
  ctxCache: Map<string, DailyContext | null>,
  stemMap: Map<string, number>,
  branchMap: Map<string, number>,
): Promise<Map<string, boolean>> => {
  const series = new Map<string, boolean>();
  for (const d of windowDates) {
    let ctx = ctxCache.get(d);
    if (ctx === undefined) {
      ctx = await getDailyContext(userId, d);
      ctxCache.set(d, ctx);
    }
    if (!ctx) {
      series.set(d, false);
      continue;
    }
    try {
      series.set(d, await evaluateTrigger(seed, ctx, stemMap, branchMap));
    } catch {
      series.set(d, false);
    }
  }
  return series;
};

const lastActivationDate = (activation: Map<string, boolean>): string | null => {
  let last: string | null = null;
  for (const [date, active] of activation) {
    if (active && (last === null || date > last)) last = date;
  }
  return last;
};

interface SignalDefRow {
  id: number;
  name: string;
  kind: 'sql' | 'tag';
  sql_body: string | null;
  value_type: 'binary' | 'continuous' | null;
  direction: SignalDirection | null;
  threshold: string | null;
  tag_name: string | null;
  window_days: number | null;
}

const toSignalDef = (row: SignalDefRow): SignalDef => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  sqlBody: row.sql_body,
  valueType: row.value_type,
  direction: row.direction,
  threshold: row.threshold === null ? null : Number(row.threshold),
  tagName: row.tag_name,
  windowDays: row.window_days,
});

interface ActiveLinkRow {
  link_id: number;
  seed_id: number;
  signal_id: number;
  status: LinkLifecycleStatus;
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
    `SELECT l.id AS link_id, l.seed_id, l.signal_id, l.status
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
  const signalRes = await query<SignalDefRow>(
    `SELECT id, name, kind, sql_body, value_type, direction, threshold, tag_name, window_days
       FROM signal_defs
      WHERE id = ANY($1::int[]) AND status = 'active'`,
    [signalIds],
  );
  const signalById = new Map(signalRes.rows.map((r) => [r.id, toSignalDef(r)]));

  const windowDates = buildWindowDates(today, V.windowCapDays);
  const [stemMap, branchMap] = await Promise.all([
    buildNameIdMap('stems_master'),
    buildNameIdMap('branches_master'),
  ]);

  // 신호 시리즈(신호당 1회) + 시드 활성 시리즈(시드당 1회) — P1 전역화 payoff.
  const signalSeriesById = new Map<number, SignalSeriesResult>();
  for (const [sid, signal] of signalById) {
    signalSeriesById.set(sid, await computeSignalSeries(userId, signal, windowDates));
  }
  const ctxCache = new Map<string, DailyContext | null>();
  const seedSeriesById = new Map<number, Map<string, boolean>>();
  for (const seedId of new Set(linkRes.rows.map((r) => r.seed_id))) {
    const seed = seedById.get(seedId);
    if (!seed) continue;
    seedSeriesById.set(
      seedId,
      await computeSeedActivationSeries(seed, userId, windowDates, ctxCache, stemMap, branchMap),
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
      const cont = buildContingency(activation, series);
      const daySeq = buildDaySequence(activation, series, windowDates);
      // 연속 신호만 Mann-Whitney(보고용). raw 분리 → U/p/Hodges-Lehmann.
      let mannWhitney: MannWhitneyResult | null = null;
      if (signal.valueType === 'continuous' && signalSeries.raw) {
        const split = splitRawByActivation(activation, signalSeries.raw, windowDates);
        if (split.active.length > 0 && split.off.length > 0) {
          mannWhitney = mannWhitneyU(split.active, split.off);
        }
      }
      return {
        row,
        signal,
        seed,
        cont,
        v: verifyContingency(cont),
        blockP: blockPermutationP(daySeq, V.blockLen, V.blockPermIters),
        mannWhitney,
        eValue: evalueTestMartingale(daySeq),
        lastMatchedAt: lastActivationDate(activation),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // empirical-Bayes 공통 prior — 전 링크 발현일 hit/miss로 추정(헌장 ④: 링크 적으면 약함).
  const ebPrior: BetaPosterior = empiricalBetaPrior(
    interim.map((x) => ({ hits: x.cont.a, misses: x.cont.b })),
  );
  // q는 자기상관 보정된 block-perm p로(Fisher는 test_detail 참고용).
  const qValues = bhFdr(interim.map((x) => x.blockP));

  return interim.map((x, i) => {
    const qValue = qValues[i] ?? NaN;
    const verdict = classifyVerdict(x.v, qValue);
    const post = cumulativePosteriorFromHitMiss(x.cont.a, x.cont.b, ebPrior);
    return {
      linkId: x.row.link_id,
      seedId: x.row.seed_id,
      signalId: x.row.signal_id,
      seedName: x.seed.name,
      patternKind: x.seed.trigger_target_type === 'life_signal' ? 'life_signal' : 'saju',
      signalName: x.signal.name,
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
      verdict,
      nextStatus: statusForVerdict(verdict, x.row.status, x.eValue),
    };
  });
};
