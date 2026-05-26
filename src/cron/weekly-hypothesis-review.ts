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
} from '../shared/saju-hypothesis.js';
import { discoverCandidates } from '../agents/insight/hypothesis-discovery.js';
import {
  buildWeeklyReviewBlocks,
  type ActiveHypothesisRow,
} from '../agents/insight/hypothesis-cards.js';
import type { LifeCronConfig } from './life-cron.js';

/** 오늘이 월요일이라는 전제 — 전주 월요일(=7일 전) 반환 */
export const previousMondayISO = (todayIso: string): string => {
  const d = new Date(`${todayIso}T12:00:00+09:00`);
  const dow = d.getUTCDay(); // 0=일, 1=월
  const daysSinceMonday = (dow + 6) % 7; // 월요일=0, 일요일=6
  return addDays(todayIso, -(daysSinceMonday + 7));
};

const loadSignalNames = async (signalIds: number[]): Promise<Map<number, string>> => {
  if (signalIds.length === 0) return new Map();
  const res = await query<{ id: number; name: string }>(
    `SELECT id, name FROM saju_signal_catalog WHERE id = ANY($1::int[])`,
    [signalIds],
  );
  return new Map(res.rows.map((r) => [r.id, r.name]));
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
  }>(
    `SELECT hypothesis_id, TO_CHAR(week_start, 'YYYY-MM-DD') AS week_start,
            n_trigger_days, n_total_days,
            rate_trigger::TEXT, rate_baseline::TEXT, rate_ratio::TEXT,
            raw_p::TEXT, fdr_q::TEXT
       FROM saju_stats
      WHERE hypothesis_id = $1 AND week_start < $2
      ORDER BY week_start DESC LIMIT 1`,
    [hypothesisId, beforeWeek],
  );
  const row = res.rows[0];
  if (!row) return null;
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
  };
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
  const signalNameMap = await loadSignalNames(signalIds);

  const statByHypothesisId = new Map(stats.map((s) => [s.hypothesisId, s]));
  const rows: ActiveHypothesisRow[] = [];
  for (const h of stillActive) {
    const latest = statByHypothesisId.get(h.id);
    if (!latest) continue;
    const prev = await loadPrevStat(h.id, weekStart);
    rows.push({
      hypothesis: h,
      signalName: signalNameMap.get(h.triggerSpec.signalId) ?? `signal#${h.triggerSpec.signalId}`,
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

  const blocks = buildWeeklyReviewBlocks(rows, candidates, weekStart);
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
