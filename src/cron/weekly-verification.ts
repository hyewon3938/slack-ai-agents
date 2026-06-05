/**
 * 주간 off-day 검증 엔진 cron — 월요일 06:00 KST (#477 P2·P3).
 * weekly-hypothesis-review를 대체. ADR-0032(통계 스택)·0033(매트릭=가설)·0034(e-value)·0035(노출).
 *
 * 흐름:
 *   1) active pattern_links 전부 off-day 대조 재계산 (verifyUserLinks — raw 윈도우 재계산 + e-value)
 *   2) 링크별 pattern_links UPDATE (counters + p/q/effect/posterior/e_value/test_detail + status 전이)
 *   3) 링크별 주간 스냅샷 link_weekly_stats write (마틴게일 trail·emerging 진행바·주간대비)
 *   4) 시드 영향력 top 5 + 검증 현황(verified / 검증중 / reject) 카드 → #insight
 *
 * P3: 확정 게이트 = e_value ≥ 1/α(=20) → status='confirmed'(verified tier). reject만 추가로 DB 반영.
 * confirmed는 sticky(verifyUserLinks가 active만 재검증). 등급 노출은 saju_influence_summary(080).
 */

import type { App } from '@slack/bolt';
import { query } from '../shared/db.js';
import { getKSTDayOfWeek, getTodayISO } from '../shared/kst.js';
import { postBlockMessage } from '../shared/slack.js';
import { DEFAULT_USER_ID, queryAllUserMappings } from '../shared/user-resolver.js';
import { verifyUserLinks, type LinkVerification } from '../shared/pattern-verification.js';
import { posteriorMean, credibleInterval } from '../shared/bayesian-posterior.js';
import {
  buildVerificationBlocks,
  type SeedInfluenceRow,
} from '../agents/insight/hypothesis-cards.js';
import type { LifeCronConfig } from './life-cron.js';

const SEED_INFLUENCE_TOP_N = 5;

/** 오늘이 월요일이라는 전제 — 전주 월요일(=7일 전) ISO 반환 (카드 라벨용). */
export const previousMondayISO = (todayIso: string): string => {
  const d = new Date(`${todayIso}T12:00:00+09:00`);
  const dow = d.getUTCDay(); // 0=일, 1=월
  const daysSinceMonday = (dow + 6) % 7;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - (daysSinceMonday + 7));
  return monday.toISOString().slice(0, 10);
};

const numOrNull = (v: number): number | null => (Number.isFinite(v) ? v : null);

/** 링크 검증 결과를 pattern_links에 SET 반영 (counters는 raw 재계산 진실로 덮어씀). */
const persistLinkVerification = async (l: LinkVerification): Promise<void> => {
  const testDetail = JSON.stringify({
    a: l.a,
    b: l.b,
    c: l.c,
    d: l.d,
    n_active: l.nActive,
    n_off: l.nOff,
    inconclusive: l.inconclusive,
    rate_active: numOrNull(l.rateActive),
    rate_off: numOrNull(l.rateOff),
    signal_kind: l.signalKind,
    value_type: l.valueType,
    verdict: l.verdict,
  });
  await query(
    `UPDATE pattern_links SET
        hit_count          = $2,
        miss_count         = $3,
        inconclusive_count = $4,
        p_value            = $5,
        q_value            = $6,
        effect             = $7,
        test_type          = 'fisher_2x2',
        posterior_alpha    = $8,
        posterior_beta     = $9,
        posterior_p        = $10,
        test_detail        = $11::jsonb,
        status             = $12,
        last_matched_at    = COALESCE($13::timestamptz, last_matched_at),
        e_value            = $14,
        updated_at         = NOW()
      WHERE id = $1`,
    [
      l.linkId,
      l.a,
      l.b,
      l.inconclusive,
      numOrNull(l.pValue),
      numOrNull(l.qValue),
      numOrNull(l.effect),
      l.posteriorAlpha,
      l.posteriorBeta,
      numOrNull(l.posteriorP),
      testDetail,
      l.nextStatus,
      l.lastMatchedAt,
      numOrNull(l.eValue),
    ],
  );
};

/**
 * 시드 영향력 top N (credible interval lower bound 정렬).
 * pattern_summary(시드 메타 + active 여부) + pattern_links(α/β 합산, status='active')에서 산출.
 * #477 P1에서 DROP된 pattern_metrics 참조를 pattern_links로 복구.
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
      WHERE user_id = $1 AND active AND aggregate_posterior_p IS NOT NULL`,
    [userId],
  );
  if (summaryRes.rows.length === 0) return [];

  const abRes = await query<{
    pattern_id: string;
    sum_alpha: string | null;
    sum_beta: string | null;
  }>(
    `SELECT seed_id::TEXT AS pattern_id,
            SUM(posterior_alpha)::TEXT AS sum_alpha,
            SUM(posterior_beta)::TEXT  AS sum_beta
       FROM pattern_links
      WHERE user_id = $1 AND status = 'active'
      GROUP BY seed_id`,
    [userId],
  );
  const abMap = new Map<string, { alpha: number; beta: number }>();
  for (const row of abRes.rows) {
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
  today: string,
): Promise<void> => {
  const results = await verifyUserLinks(userId, today);

  let persisted = 0;
  for (const l of results) {
    // per-link 격리(#434 Phase 8a) — 한 링크 UPDATE 실패가 전체를 막지 않게.
    try {
      await persistLinkVerification(l);
      persisted += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Verification] 링크 UPDATE 실패 link=${l.linkId}: ${msg}`);
    }
  }

  let seedInfluence: SeedInfluenceRow[] = [];
  try {
    seedInfluence = await loadSeedInfluence(userId, SEED_INFLUENCE_TOP_N);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Verification] 시드 영향력 로드 실패 user=${userId}: ${msg}`);
  }

  const confirms = results.filter((l) => l.verdict === 'confirm').length;
  const rejects = results.filter((l) => l.verdict === 'reject').length;
  console.warn(
    `[Verification] user=${userId} 링크 ${results.length} (persist ${persisted}) confirm ${confirms} reject ${rejects}`,
  );

  const blocks = buildVerificationBlocks(weekStart, results, seedInfluence);
  const fallback = `패턴 검증 주간 리포트 (${weekStart} ~) — 링크 ${results.length}건`;
  try {
    await postBlockMessage(app.client, channelId, fallback, blocks);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Verification] 카드 전송 실패 user=${userId}: ${msg}`);
  }
};

/**
 * 본체 — life-cron SLOT_TASKS에서 호출. 매일 등록되지만 월요일만 실행(weeklyReport 패턴).
 */
export const weeklyVerificationTask = async (app: App, config: LifeCronConfig): Promise<void> => {
  if (getKSTDayOfWeek() !== 1) return;
  const today = getTodayISO();
  const weekStart = previousMondayISO(today);
  const mappings = await queryAllUserMappings();
  const insightFallback = process.env['INSIGHT_CHANNEL_ID'] ?? config.channelId;

  if (mappings.length === 0) {
    if (!insightFallback) return;
    await processUser(app, DEFAULT_USER_ID, insightFallback, weekStart, today);
    return;
  }

  for (const mapping of mappings) {
    const channelId = mapping.insightChannelId ?? insightFallback;
    if (!channelId) continue;
    try {
      await processUser(app, mapping.userId, channelId, weekStart, today);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Verification] user=${mapping.userId} 처리 실패: ${msg}`);
    }
  }
};
