/**
 * 주간 가설 리포트 cron — 월요일 08:00 KST.
 * ADR-0019 Phase 4.
 *
 * 흐름:
 *   1) 전주 월요일~일요일 윈도우 계산
 *   2) 유저별 active 가설 → computeAndPersistWeeklyStats (Fisher + BH-FDR)
 *   3) 가설별 evaluateStatusTransition → DB UPDATE
 *   4) discoverCandidates (recurring 모드) → 신규 후보
 *   5) #insight 채널로 묶음 카드 발송
 */

import type { App } from '@slack/bolt';
import { query } from '../shared/db.js';
import { addDays, getKSTDayOfWeek, getTodayISO } from '../shared/kst.js';
import { postBlockMessage } from '../shared/slack.js';
import { DEFAULT_USER_ID, queryAllUserMappings } from '../shared/user-resolver.js';
import {
  applyStatusTransition,
  computeAndPersistWeeklyStats,
  evaluateStatusTransition,
  loadActiveHypotheses,
  type HypothesisStat,
} from '../shared/pattern-hypothesis.js';
import { posteriorMean, credibleInterval } from '../shared/bayesian-posterior.js';
import { discoverCandidates } from '../agents/insight/hypothesis-discovery.js';
import {
  buildWeeklyReviewBlocks,
  type ActiveHypothesisRow,
  type SeedInfluenceRow,
} from '../agents/insight/hypothesis-cards.js';
import type { LifeCronConfig } from './life-cron.js';

const SEED_INFLUENCE_TOP_N = 5;

/**
 * #477 P1 — 주간 가설 리뷰 비활성 플래그.
 * pattern_hypotheses/pattern_stats DROP으로 가설×통계 기반 리뷰는 동작 불가.
 * P2 주간 검증 엔진(pattern_links window 재계산)으로 재구축 시 false로 전환/제거.
 */
const WEEKLY_REVIEW_SUSPENDED_P1 = true;

/** 오늘이 월요일이라는 전제 — 전주 월요일(=7일 전) 반환 */
export const previousMondayISO = (todayIso: string): string => {
  const d = new Date(`${todayIso}T12:00:00+09:00`);
  const dow = d.getUTCDay(); // 0=일, 1=월
  const daysSinceMonday = (dow + 6) % 7; // 월요일=0, 일요일=6
  return addDays(todayIso, -(daysSinceMonday + 7));
};

interface SignalMeta {
  name: string;
  patternKind: 'saju' | 'life_signal';
}

const loadSignalMeta = async (signalIds: number[]): Promise<Map<number, SignalMeta>> => {
  if (signalIds.length === 0) return new Map();
  const res = await query<{ id: number; name: string; pattern_kind: 'saju' | 'life_signal' }>(
    `SELECT id, name, pattern_kind FROM pattern_catalog WHERE id = ANY($1::int[])`,
    [signalIds],
  );
  return new Map(res.rows.map((r) => [r.id, { name: r.name, patternKind: r.pattern_kind }]));
};

const loadPrevStat = async (
  hypothesisId: number,
  beforeWeek: string,
): Promise<HypothesisStat | null> => {
  const res = await query<{
    hypothesis_id: number;
    week_start: string;
    n_trigger_days: number;
    n_total_days: number;
    rate_trigger: string;
    rate_baseline: string;
    rate_ratio: string;
    raw_p: string;
    fdr_q: string;
    posterior_alpha: string | null;
    posterior_beta: string | null;
    posterior_p: string | null;
  }>(
    `SELECT hypothesis_id, TO_CHAR(week_start, 'YYYY-MM-DD') AS week_start,
            n_trigger_days, n_total_days,
            rate_trigger::TEXT, rate_baseline::TEXT, rate_ratio::TEXT,
            raw_p::TEXT, fdr_q::TEXT,
            posterior_alpha::TEXT, posterior_beta::TEXT, posterior_p::TEXT
       FROM pattern_stats
      WHERE hypothesis_id = $1 AND week_start < $2
      ORDER BY week_start DESC LIMIT 1`,
    [hypothesisId, beforeWeek],
  );
  const row = res.rows[0];
  if (!row) return null;
  const alpha = row.posterior_alpha === null ? NaN : Number(row.posterior_alpha);
  const beta = row.posterior_beta === null ? NaN : Number(row.posterior_beta);
  const { lower, upper } = credibleInterval(alpha, beta);
  return {
    hypothesisId: row.hypothesis_id,
    weekStart: row.week_start,
    nTriggerDays: row.n_trigger_days,
    nTotalDays: row.n_total_days,
    rateTrigger: Number(row.rate_trigger),
    rateBaseline: Number(row.rate_baseline),
    rateRatio: Number(row.rate_ratio),
    rawP: Number(row.raw_p),
    fdrQ: Number(row.fdr_q),
    posteriorAlpha: alpha,
    posteriorBeta: beta,
    posteriorP: row.posterior_p === null ? posteriorMean(alpha, beta) : Number(row.posterior_p),
    ciLower: lower,
    ciUpper: upper,
  };
};

/**
 * 시드 영향력 top N (credible interval lower bound 정렬).
 * pattern_summary view에서 시드 메타 + aggregate posterior 평균을 가져오고,
 * α/β 합산은 view contract 보존을 위해 별도 query로 산출.
 */
const loadSeedInfluence = async (userId: number, topN: number): Promise<SeedInfluenceRow[]> => {
  const summaryRes = await query<{
    pattern_id: string;
    pattern_kind: 'saju' | 'life_signal';
    pattern_name: string;
    pattern_description: string | null;
    total_hits: string;
    total_misses: string;
  }>(
    `SELECT pattern_id::TEXT, pattern_kind, pattern_name, pattern_description,
            total_hits::TEXT, total_misses::TEXT
       FROM pattern_summary
      WHERE user_id = $1
        AND active
        AND aggregate_posterior_p IS NOT NULL`,
    [userId],
  );
  if (summaryRes.rows.length === 0) return [];

  const alphaBetaRes = await query<{
    pattern_id: string;
    sum_alpha: string | null;
    sum_beta: string | null;
  }>(
    `SELECT pattern_id::TEXT,
            SUM(posterior_alpha)::TEXT AS sum_alpha,
            SUM(posterior_beta)::TEXT  AS sum_beta
       FROM pattern_metrics
      WHERE user_id = $1 AND status = 'active'
      GROUP BY pattern_id`,
    [userId],
  );
  const abMap = new Map<string, { alpha: number; beta: number }>();
  for (const row of alphaBetaRes.rows) {
    const alpha = row.sum_alpha === null ? NaN : Number(row.sum_alpha);
    const beta = row.sum_beta === null ? NaN : Number(row.sum_beta);
    abMap.set(row.pattern_id, { alpha, beta });
  }

  const rows: SeedInfluenceRow[] = [];
  for (const r of summaryRes.rows) {
    const ab = abMap.get(r.pattern_id);
    if (!ab || !Number.isFinite(ab.alpha) || !Number.isFinite(ab.beta)) continue;
    const mean = posteriorMean(ab.alpha, ab.beta);
    const { lower, upper } = credibleInterval(ab.alpha, ab.beta);
    if (!Number.isFinite(lower)) continue;
    rows.push({
      patternId: Number(r.pattern_id),
      patternKind: r.pattern_kind,
      signalName: r.pattern_name,
      description: r.pattern_description,
      totalHits: Math.max(0, Math.round(Number(r.total_hits))),
      totalMisses: Math.max(0, Math.round(Number(r.total_misses))),
      posteriorP: mean,
      ciLower: lower,
      ciUpper: upper,
    });
  }

  rows.sort((a, b) => b.ciLower - a.ciLower);
  return rows.slice(0, topN);
};

const processUser = async (
  app: App,
  userId: number,
  channelId: string,
  weekStart: string,
): Promise<void> => {
  const active = await loadActiveHypotheses(userId);

  const stats = await computeAndPersistWeeklyStats(userId, active, weekStart);

  for (const h of active) {
    try {
      const next = await evaluateStatusTransition(h.id);
      if (next !== 'active') {
        await applyStatusTransition(h.id, next);
        console.warn(`[Hypothesis Review] hypothesis ${h.id}: active → ${next}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Hypothesis Review] 상태 평가 실패 hypothesis=${h.id}: ${msg}`);
    }
  }

  const stillActive = await loadActiveHypotheses(userId);
  const signalIds = Array.from(
    new Set([
      ...stillActive.map((h) => h.triggerSpec.signalId),
      ...active.map((h) => h.triggerSpec.signalId),
    ]),
  );
  const signalMetaMap = await loadSignalMeta(signalIds);

  const statByHypothesisId = new Map(stats.map((s) => [s.hypothesisId, s]));
  const rows: ActiveHypothesisRow[] = [];
  for (const h of stillActive) {
    const latest = statByHypothesisId.get(h.id);
    if (!latest) continue;
    const prev = await loadPrevStat(h.id, weekStart);
    const meta = signalMetaMap.get(h.triggerSpec.signalId);
    rows.push({
      hypothesis: h,
      signalName: meta?.name ?? `signal#${h.triggerSpec.signalId}`,
      patternKind: meta?.patternKind ?? 'saju',
      latest,
      prev,
    });
  }

  let candidates: Awaited<ReturnType<typeof discoverCandidates>> = [];
  try {
    candidates = await discoverCandidates(userId, { mode: 'recurring', weekStart });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Hypothesis Review] discover 실패 user=${userId}: ${msg}`);
  }

  let seedInfluence: SeedInfluenceRow[] = [];
  try {
    seedInfluence = await loadSeedInfluence(userId, SEED_INFLUENCE_TOP_N);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Hypothesis Review] 시드 영향력 로드 실패 user=${userId}: ${msg}`);
  }

  const blocks = buildWeeklyReviewBlocks(rows, candidates, weekStart, seedInfluence);
  const fallback = `가설 주간 리포트 (${weekStart} ~) — active ${rows.length}건, 신규 후보 ${candidates.length}건`;

  try {
    await postBlockMessage(app.client, channelId, fallback, blocks);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Hypothesis Review] 카드 전송 실패 user=${userId}: ${msg}`);
  }
};

/**
 * 본체 — life-cron SLOT_TASKS에서 호출.
 * cron은 매일 08:00에 발송되지만 월요일만 실행 (weeklyReport 패턴과 동일).
 */
export const weeklyHypothesisReviewTask = async (
  app: App,
  config: LifeCronConfig,
): Promise<void> => {
  // #477 P1: 가설×통계 테이블 DROP — P2 주간 검증 엔진 재구축까지 비활성. 등록은 유지(P2 교체).
  if (WEEKLY_REVIEW_SUSPENDED_P1) {
    console.warn('[Hypothesis Review] #477 P1 — P2 주간 검증 엔진 대기, 비활성 (skip)');
    return;
  }
  if (getKSTDayOfWeek() !== 1) return;
  const weekStart = previousMondayISO(getTodayISO());
  const mappings = await queryAllUserMappings();
  const insightFallback = process.env['INSIGHT_CHANNEL_ID'] ?? config.channelId;

  if (mappings.length === 0) {
    if (!insightFallback) return;
    await processUser(app, DEFAULT_USER_ID, insightFallback, weekStart);
    return;
  }

  for (const mapping of mappings) {
    const channelId = mapping.insightChannelId ?? insightFallback;
    if (!channelId) continue;
    try {
      await processUser(app, mapping.userId, channelId, weekStart);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Hypothesis Review] user=${mapping.userId} 처리 실패: ${msg}`);
    }
  }
};
