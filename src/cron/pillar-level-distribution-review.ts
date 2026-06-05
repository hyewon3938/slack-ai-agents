/**
 * 운 레벨 분포 분석 cron — 월요일 09:15 KST.
 * 마스터 #434 Phase 2.5 (ADR-0027 결정론 SQL + ADR-0028 풀셋 임계치).
 *
 * 흐름:
 *   1) 90일 윈도우의 seed_daily_activations를 pillar_level별 hit-rate 분포 집계
 *   2) cumulative_pillar_count trigger의 N=1..5 분포 집계
 *   3) 데이터 부족 시 (양쪽 모두 0건) 발송 스킵
 *   4) insight 채널에 한 줄 압축 메시지 발송
 *
 * 임의 임계치 안 박음. 분포만 그대로 노출 → 사용자가 임계치 학습 시점 판단.
 */

import type { App } from '@slack/bolt';
import { query } from '../shared/db.js';
import { getKSTDayOfWeek } from '../shared/kst.js';
import { postToChannel } from '../shared/slack.js';
import { queryAllUserMappings, DEFAULT_USER_ID } from '../shared/user-resolver.js';
import type { LifeCronConfig } from './life-cron.js';

export interface PillarRow {
  pillar_level: string | null;
  matches: string;
  hits: string;
  hit_rate_pct: string | null;
}

export interface CumulativeRow {
  count_min: number | null;
  element: string | null;
  sipsin: string | null;
  matches: string;
  hits: string;
}

const SQL_PILLAR_DISTRIBUTION = `
  SELECT
    c.pillar_level,
    COUNT(m.id)::TEXT AS matches,
    SUM(CASE WHEN m.matched = true THEN 1 ELSE 0 END)::TEXT AS hits,
    ROUND(
      100.0 * SUM(CASE WHEN m.matched = true THEN 1 ELSE 0 END)
      / NULLIF(COUNT(m.id) FILTER (WHERE m.matched IS NOT NULL), 0),
      1
    )::TEXT AS hit_rate_pct
  FROM pattern_catalog c
  JOIN seed_daily_activations m ON m.pattern_id = c.id
  WHERE c.pattern_kind = 'saju'
    AND c.user_id = $1
    AND m.date >= CURRENT_DATE - INTERVAL '90 days'
    AND m.matched IS NOT NULL
  GROUP BY c.pillar_level
  ORDER BY hit_rate_pct DESC NULLS LAST
`;

const SQL_CUMULATIVE_DISTRIBUTION = `
  SELECT
    (c.trigger_aux->>'count_min')::INT AS count_min,
    c.trigger_aux->>'element' AS element,
    c.trigger_aux->>'sipsin' AS sipsin,
    COUNT(m.id)::TEXT AS matches,
    SUM(CASE WHEN m.matched = true THEN 1 ELSE 0 END)::TEXT AS hits
  FROM pattern_catalog c
  JOIN seed_daily_activations m ON m.pattern_id = c.id
  WHERE c.trigger_target_type = 'cumulative_pillar_count'
    AND c.user_id = $1
    AND m.date >= CURRENT_DATE - INTERVAL '90 days'
    AND m.matched IS NOT NULL
  GROUP BY count_min, element, sipsin
  ORDER BY element, sipsin, count_min
`;

export const buildMessage = (pillarRows: PillarRow[], cumRows: CumulativeRow[]): string | null => {
  if (pillarRows.length === 0 && cumRows.length === 0) return null;

  const lines: string[] = ['📊 운 레벨 분포 (90일 윈도우)'];
  for (const row of pillarRows) {
    const level = row.pillar_level ?? '(unknown)';
    const rate = row.hit_rate_pct ?? '-';
    lines.push(`- ${level}: ${row.matches}건, hit ${rate}%`);
  }
  if (cumRows.length > 0) {
    lines.push('', '🔢 누적 카운트 분포 (오행/십성 × N=1..5)');
    for (const row of cumRows) {
      const key = row.element ? `${row.element} 오행` : (row.sipsin ?? '?');
      const n = row.count_min ?? '?';
      lines.push(`- ${key} N=${n}: ${row.matches}건, hit ${row.hits}`);
    }
  }
  return lines.join('\n');
};

const processUser = async (app: App, userId: number, channelId: string): Promise<void> => {
  const [pillarRes, cumRes] = await Promise.all([
    query<PillarRow>(SQL_PILLAR_DISTRIBUTION, [userId]),
    query<CumulativeRow>(SQL_CUMULATIVE_DISTRIBUTION, [userId]),
  ]);

  const message = buildMessage(pillarRes.rows, cumRes.rows);
  if (!message) {
    console.warn(`[Pillar Distribution] user=${userId} 데이터 부족 — 발송 스킵`);
    return;
  }

  await postToChannel(app.client, channelId, message);
};

/**
 * 본체 — life-cron SLOT_TASKS에서 호출.
 * 등록 시각은 09:15이지만 월요일만 실행 (weeklyHypothesisReview 패턴 동일).
 */
export const pillarLevelDistributionReviewTask = async (
  app: App,
  config: LifeCronConfig,
): Promise<void> => {
  if (getKSTDayOfWeek() !== 1) return;
  const mappings = await queryAllUserMappings();
  const insightFallback = process.env['INSIGHT_CHANNEL_ID'] ?? config.channelId;

  if (mappings.length === 0) {
    if (!insightFallback) return;
    await processUser(app, DEFAULT_USER_ID, insightFallback);
    return;
  }

  for (const mapping of mappings) {
    const channelId = mapping.insightChannelId ?? insightFallback;
    if (!channelId) continue;
    try {
      await processUser(app, mapping.userId, channelId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Pillar Distribution] user=${mapping.userId} 처리 실패: ${msg}`);
    }
  }
};
