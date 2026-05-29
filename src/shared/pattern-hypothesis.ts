/**
 * 사주 가설-검증 정량 파이프라인 — ADR-0019 Phase 4
 *
 * - Fisher's exact test (소표본 + 이진 outcome)
 * - rate ratio (효과 크기)
 * - BH-FDR (다중 비교 보정)
 * - 주간 통계 영속화 + 상태 전이 평가
 */

import { query } from './db.js';
import {
  cumulativePosteriorFromHitMiss,
  posteriorMean,
  credibleInterval,
} from './bayesian-posterior.js';

// ─── 타입 정의 ───────────────────────────────────────────

export type TriggerSpec = { type: 'seed'; signalId: number };

export type HypothesisStatus = 'active' | 'confirmed' | 'rejected' | 'archived';

export interface Hypothesis {
  id: number;
  userId: number;
  triggerSpec: TriggerSpec;
  enumTarget: string;
  status: HypothesisStatus;
  source: 'discovery' | 'manual';
  registeredAt: Date;
  confirmedAt: Date | null;
  rejectedAt: Date | null;
  archivedAt: Date | null;
  notes: string | null;
}

export interface HypothesisStat {
  hypothesisId: number;
  weekStart: string;
  nTriggerDays: number;
  nTotalDays: number;
  rateTrigger: number;
  rateBaseline: number;
  rateRatio: number;
  rawP: number;
  fdrQ: number;
  // Phase 7 — Beta-Binomial 가설 단위 posterior (누적 hit/miss 기반, prior Beta(1,1))
  posteriorAlpha: number;
  posteriorBeta: number;
  posteriorP: number;
  ciLower: number;
  ciUpper: number;
}

// ─── 통계 알고리즘 (pure 함수) ─────────────────────────

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

// ─── DB 조회 + 통계 계산 ────────────────────────────────

const MIN_TRIGGER_SAMPLE = 5;
const BASELINE_LOOKBACK_DAYS = 90;

interface TriggerWindow {
  triggerDates: Set<string>;
  enumDates: Set<string>;
  totalDays: number;
}

const loadTriggerWindow = async (
  userId: number,
  signalId: number,
  enumTarget: string,
  startDate: string,
  endDate: string,
): Promise<TriggerWindow> => {
  const triggerRes = await query<{ date: string }>(
    `SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date
       FROM pattern_matches
      WHERE user_id = $1 AND pattern_id = $2
        AND date >= $3 AND date <= $4
        AND trigger_activated = true`,
    [userId, signalId, startDate, endDate],
  );
  const enumRes = await query<{ date: string }>(
    `SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date
       FROM diary_meta_tags
      WHERE user_id = $1 AND tag = $2
        AND date >= $3 AND date <= $4`,
    [userId, enumTarget, startDate, endDate],
  );
  const dayCountRes = await query<{ days: string }>(
    `SELECT (DATE($2) - DATE($1) + 1)::TEXT AS days`,
    [startDate, endDate],
  );
  return {
    triggerDates: new Set(triggerRes.rows.map((r) => r.date)),
    enumDates: new Set(enumRes.rows.map((r) => r.date)),
    totalDays: Number(dayCountRes.rows[0]?.days ?? 0),
  };
};

/**
 * 단일 가설 통계 계산 — fdr_q는 별도 보정 단계에서 채움.
 * baseline은 BASELINE_LOOKBACK_DAYS(90일) 윈도우의 trigger 비발현일.
 * trigger 발현 < MIN_TRIGGER_SAMPLE(5)이면 raw_p = NaN(skip).
 */
export const computeHypothesisStat = async (
  userId: number,
  hypothesis: Pick<Hypothesis, 'id' | 'triggerSpec' | 'enumTarget'>,
  weekStart: string,
): Promise<
  Omit<
    HypothesisStat,
    'fdrQ' | 'posteriorAlpha' | 'posteriorBeta' | 'posteriorP' | 'ciLower' | 'ciUpper'
  >
> => {
  const baselineStart = shiftDate(weekStart, -BASELINE_LOOKBACK_DAYS + 7);
  const weekEnd = shiftDate(weekStart, 6);
  const window = await loadTriggerWindow(
    userId,
    hypothesis.triggerSpec.signalId,
    hypothesis.enumTarget,
    baselineStart,
    weekEnd,
  );

  const triggerDays = window.triggerDates.size;
  const totalDays = window.totalDays;
  const nonTriggerDays = totalDays - triggerDays;

  let triggerHits = 0;
  let nonTriggerHits = 0;
  for (const date of window.enumDates) {
    if (window.triggerDates.has(date)) triggerHits++;
    else nonTriggerHits++;
  }

  const rateTrigger = triggerDays > 0 ? triggerHits / triggerDays : 0;
  const rateBaseline = nonTriggerDays > 0 ? nonTriggerHits / nonTriggerDays : 0;
  const rateRatio = rateBaseline > 0 ? rateTrigger / rateBaseline : NaN;

  const rawP =
    triggerDays < MIN_TRIGGER_SAMPLE
      ? NaN
      : fisherExact(
          triggerHits,
          triggerDays - triggerHits,
          nonTriggerHits,
          nonTriggerDays - nonTriggerHits,
        );

  return {
    hypothesisId: hypothesis.id,
    weekStart,
    nTriggerDays: triggerDays,
    nTotalDays: totalDays,
    rateTrigger,
    rateBaseline,
    rateRatio,
    rawP,
  };
};

/**
 * 다중 가설 통계 일괄 계산 + BH-FDR 보정 + pattern_stats UPSERT.
 * UPSERT는 (hypothesis_id, week_start) UNIQUE 충돌 시 갱신.
 */
export const computeAndPersistWeeklyStats = async (
  userId: number,
  hypotheses: Pick<Hypothesis, 'id' | 'triggerSpec' | 'enumTarget'>[],
  weekStart: string,
): Promise<HypothesisStat[]> => {
  if (hypotheses.length === 0) return [];

  const rawStats = await Promise.all(
    hypotheses.map((h) => computeHypothesisStat(userId, h, weekStart)),
  );
  const qValues = bhFdr(rawStats.map((s) => s.rawP));

  const finalStats: HypothesisStat[] = [];
  for (let i = 0; i < rawStats.length; i++) {
    const stat = rawStats[i];
    if (!stat) continue;
    const fdrQ = qValues[i] ?? NaN;

    // 가설 단위 누적 hit/miss: 이전 주들의 누적을 SELECT + 이번 주 derive 합산
    const cumulativeRes = await query<{ total_hits: string; total_misses: string }>(
      `SELECT
         COALESCE(SUM((rate_trigger * n_trigger_days)::NUMERIC), 0)::TEXT AS total_hits,
         COALESCE(SUM(n_trigger_days - (rate_trigger * n_trigger_days)::NUMERIC), 0)::TEXT AS total_misses
       FROM pattern_stats
       WHERE hypothesis_id = $1 AND week_start < $2`,
      [stat.hypothesisId, stat.weekStart],
    );
    const priorHits = Math.max(0, Math.round(Number(cumulativeRes.rows[0]?.total_hits ?? 0)));
    const priorMisses = Math.max(0, Math.round(Number(cumulativeRes.rows[0]?.total_misses ?? 0)));
    const weekHits = Math.max(0, Math.round(stat.rateTrigger * stat.nTriggerDays));
    const weekMisses = Math.max(0, stat.nTriggerDays - weekHits);
    const { alpha, beta } = cumulativePosteriorFromHitMiss(
      priorHits + weekHits,
      priorMisses + weekMisses,
    );
    const posteriorP = posteriorMean(alpha, beta);
    const { lower: ciLower, upper: ciUpper } = credibleInterval(alpha, beta);

    finalStats.push({
      ...stat,
      fdrQ,
      posteriorAlpha: alpha,
      posteriorBeta: beta,
      posteriorP,
      ciLower,
      ciUpper,
    });

    await query(
      `INSERT INTO pattern_stats
         (hypothesis_id, week_start, n_trigger_days, n_total_days,
          rate_trigger, rate_baseline, rate_ratio, raw_p, fdr_q,
          posterior_alpha, posterior_beta, posterior_p)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (hypothesis_id, week_start) DO UPDATE SET
         n_trigger_days  = EXCLUDED.n_trigger_days,
         n_total_days    = EXCLUDED.n_total_days,
         rate_trigger    = EXCLUDED.rate_trigger,
         rate_baseline   = EXCLUDED.rate_baseline,
         rate_ratio      = EXCLUDED.rate_ratio,
         raw_p           = EXCLUDED.raw_p,
         fdr_q           = EXCLUDED.fdr_q,
         posterior_alpha = EXCLUDED.posterior_alpha,
         posterior_beta  = EXCLUDED.posterior_beta,
         posterior_p     = EXCLUDED.posterior_p,
         computed_at     = NOW()`,
      [
        stat.hypothesisId,
        stat.weekStart,
        stat.nTriggerDays,
        stat.nTotalDays,
        stat.rateTrigger,
        stat.rateBaseline,
        Number.isNaN(stat.rateRatio) ? 'NaN' : stat.rateRatio,
        Number.isNaN(stat.rawP) ? 'NaN' : stat.rawP,
        Number.isNaN(fdrQ) ? 'NaN' : fdrQ,
        alpha,
        beta,
        Number.isNaN(posteriorP) ? 'NaN' : posteriorP,
      ],
    );
  }

  return finalStats;
};

// ─── 상태 전이 평가 ─────────────────────────────────────

const CONFIRM_MIN_N = 30;
const CONFIRM_MAX_Q = 0.05;
const CONFIRM_MIN_RATE_RATIO = 1.3;
const REJECT_RATE_LOW = 0.95;
const REJECT_RATE_HIGH = 1.05;
const RECENT_WEEKS = 4;

/**
 * 가설 상태 전이 평가 (active만 대상).
 *   active → confirmed: 누적 n_trigger_days ≥ 30 AND 최근 4주 평균 q < 0.05 AND 평균 rate_ratio ≥ 1.3
 *   active → rejected:  누적 n_trigger_days ≥ 30 AND 최근 4주 모두 rate_ratio in [0.95, 1.05]
 *   둘 다 아니면 active 유지.
 */
export const evaluateStatusTransition = async (hypothesisId: number): Promise<HypothesisStatus> => {
  const cumulativeRes = await query<{ total: string }>(
    `SELECT COALESCE(SUM(n_trigger_days), 0)::TEXT AS total
       FROM pattern_stats WHERE hypothesis_id = $1`,
    [hypothesisId],
  );
  const cumulativeN = Number(cumulativeRes.rows[0]?.total ?? 0);
  if (cumulativeN < CONFIRM_MIN_N) return 'active';

  const recentRes = await query<{
    rate_ratio: string;
    fdr_q: string;
  }>(
    `SELECT rate_ratio::TEXT, fdr_q::TEXT
       FROM pattern_stats WHERE hypothesis_id = $1
       ORDER BY week_start DESC LIMIT $2`,
    [hypothesisId, RECENT_WEEKS],
  );
  if (recentRes.rows.length < RECENT_WEEKS) return 'active';

  const ratios = recentRes.rows.map((r) => Number(r.rate_ratio));
  const qs = recentRes.rows.map((r) => Number(r.fdr_q));

  const validQs = qs.filter((q) => Number.isFinite(q));
  const validRatios = ratios.filter((r) => Number.isFinite(r));
  if (validQs.length < RECENT_WEEKS || validRatios.length < RECENT_WEEKS) return 'active';

  const avgQ = validQs.reduce((a, b) => a + b, 0) / validQs.length;
  const avgRatio = validRatios.reduce((a, b) => a + b, 0) / validRatios.length;

  if (avgQ < CONFIRM_MAX_Q && avgRatio >= CONFIRM_MIN_RATE_RATIO) return 'confirmed';

  const allFlat = validRatios.every((r) => r >= REJECT_RATE_LOW && r <= REJECT_RATE_HIGH);
  if (allFlat) return 'rejected';

  return 'active';
};

/** 상태 전이 적용 — DB 갱신 + timestamp 기록 */
export const applyStatusTransition = async (
  hypothesisId: number,
  next: HypothesisStatus,
): Promise<void> => {
  if (next === 'active') return;
  const columnMap: Record<Exclude<HypothesisStatus, 'active'>, string> = {
    confirmed: 'confirmed_at',
    rejected: 'rejected_at',
    archived: 'archived_at',
  };
  const column = columnMap[next];
  await query(
    `UPDATE pattern_hypotheses
        SET status = $1, ${column} = NOW()
      WHERE id = $2 AND status = 'active'`,
    [next, hypothesisId],
  );
};

// ─── 헬퍼 ────────────────────────────────────────────────

const shiftDate = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export const loadActiveHypotheses = async (userId: number): Promise<Hypothesis[]> => {
  const res = await query<{
    id: number;
    user_id: number;
    trigger_spec: TriggerSpec;
    enum_target: string;
    status: HypothesisStatus;
    source: 'discovery' | 'manual';
    registered_at: Date;
    confirmed_at: Date | null;
    rejected_at: Date | null;
    archived_at: Date | null;
    notes: string | null;
  }>(
    `SELECT id, user_id, trigger_spec, enum_target, status, source,
            registered_at, confirmed_at, rejected_at, archived_at, notes
       FROM pattern_hypotheses WHERE user_id = $1 AND status = 'active'
       ORDER BY id`,
    [userId],
  );
  return res.rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    triggerSpec: r.trigger_spec,
    enumTarget: r.enum_target,
    status: r.status,
    source: r.source,
    registeredAt: r.registered_at,
    confirmedAt: r.confirmed_at,
    rejectedAt: r.rejected_at,
    archivedAt: r.archived_at,
    notes: r.notes,
  }));
};
