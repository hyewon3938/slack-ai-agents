/**
 * 프로액티브 인사이트 v2 Phase 2 — LLM 자율 발견 조회 fast path + Slack 메시지 빌더.
 *
 * 사용자 자연어 ("발견 검증", "정확도", "LLM 어땠어") → 누적 통계 + 최근 발견 N개.
 * Cron이 신규 발견을 발송할 때도 동일 모듈의 빌더 사용 (점진적 노출 로직 포함).
 */

import type { AgentHandler } from '../../router.js';
import type { KnownBlock } from '@slack/types';
import { query } from '../../shared/db.js';
import { sendMessage } from '../../shared/slack.js';
import type { InsightSlot } from '../../shared/llm-insights.js';
import type { LlmInsightDraft } from '../../shared/llm-insight-prompts.js';

const LLM_INSIGHT_FAST_PATH_RE = /(발견.*검증|정확도|LLM.*(어땠|어때|어떻게))/i;
const VERIFIED_THRESHOLD_FOR_DISCLOSURE = 10;
const RECENT_INSIGHTS_LIMIT = 5;

interface OutcomeCountRow {
  outcome: string;
  cnt: string;
}

interface RecentInsightRow {
  discovered_at: string;
  slot: string;
  signal_text: string;
  hypothesis_text: string;
  confidence: string;
  outcome: string;
  verified_at: string | null;
}

interface AccuracyStats {
  totalVerified: number;
  hit: number;
  miss: number;
  inconclusive: number;
  pending: number;
  hitRate: number | null;
}

const queryAccuracyStats = async (userId: number): Promise<AccuracyStats> => {
  const result = await query<OutcomeCountRow>(
    `SELECT outcome, COUNT(*)::text AS cnt
     FROM llm_insights
     WHERE user_id = $1
     GROUP BY outcome`,
    [userId],
  );

  const counts = { hit: 0, miss: 0, inconclusive: 0, pending: 0 };
  for (const row of result.rows) {
    const n = Number(row.cnt);
    if (row.outcome === 'hit') counts.hit = n;
    else if (row.outcome === 'miss') counts.miss = n;
    else if (row.outcome === 'inconclusive') counts.inconclusive = n;
    else if (row.outcome === 'pending') counts.pending = n;
  }
  const totalVerified = counts.hit + counts.miss;
  const hitRate = totalVerified > 0 ? Math.round((counts.hit / totalVerified) * 100) : null;
  return { ...counts, totalVerified, hitRate };
};

const queryRecentInsights = async (userId: number, limit: number): Promise<RecentInsightRow[]> => {
  const result = await query<RecentInsightRow>(
    `SELECT discovered_at::text, slot, signal_text, hypothesis_text, confidence, outcome,
            verified_at::text
     FROM llm_insights
     WHERE user_id = $1
     ORDER BY discovered_at DESC
     LIMIT $2`,
    [userId, limit],
  );
  return result.rows;
};

const formatOutcomeLabel = (outcome: string): string => {
  if (outcome === 'hit') return '적중';
  if (outcome === 'miss') return '빗나감';
  if (outcome === 'inconclusive') return '판정 불가';
  return '검증 대기';
};

const buildAccuracyLine = (stats: AccuracyStats): string => {
  if (stats.totalVerified === 0) {
    return `누적 검증: 0건 (대기 ${stats.pending}건)`;
  }
  return `누적 검증 ${stats.totalVerified}건 중 ${stats.hit}건 적중 (${stats.hitRate ?? 0}%) — 대기 ${stats.pending}건, 판정불가 ${stats.inconclusive}건`;
};

const buildRecentBlock = (rows: RecentInsightRow[]): KnownBlock => {
  if (rows.length === 0) {
    return {
      type: 'section',
      text: { type: 'mrkdwn', text: '아직 발견된 패턴이 없어. 다음 슬롯을 기다려보자.' },
    };
  }
  const lines = rows.map((r) => {
    const date = r.discovered_at.slice(0, 10);
    const outcomeLabel = formatOutcomeLabel(r.outcome);
    return `• \`${date}\` ${outcomeLabel} (${r.slot})\n  시그널: ${r.signal_text}\n  가설: ${r.hypothesis_text}`;
  });
  return {
    type: 'section',
    text: { type: 'mrkdwn', text: `*최근 발견 ${rows.length}건*\n${lines.join('\n\n')}` },
  };
};

/** fast path 매칭. 매칭되면 응답 후 true. */
export const tryLlmInsightFastPath = async (
  trimmed: string,
  say: Parameters<AgentHandler>[1],
  userId: number,
): Promise<boolean> => {
  if (!LLM_INSIGHT_FAST_PATH_RE.test(trimmed)) return false;

  try {
    const [stats, recent] = await Promise.all([
      queryAccuracyStats(userId),
      queryRecentInsights(userId, RECENT_INSIGHTS_LIMIT),
    ]);

    const blocks: KnownBlock[] = [
      { type: 'header', text: { type: 'plain_text', text: 'LLM 자율 발견 현황', emoji: false } },
      { type: 'section', text: { type: 'mrkdwn', text: buildAccuracyLine(stats) } },
      { type: 'divider' },
      buildRecentBlock(recent),
    ];

    await say({ text: 'LLM 자율 발견 현황', blocks });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Insight Agent] LLM 발견 조회 fast path 오류:', msg);
    await sendMessage(say, 'LLM 자율 발견 조회 중 오류가 발생했어.');
  }
  return true;
};

// ─── Cron용 빌더 ───────────────────────────────────────

export interface LlmInsightSlackMessage {
  headerText: string;
  blocks: KnownBlock[];
}

const formatSlotLabel = (slot: InsightSlot): string => (slot === 'weekly' ? '주간' : '월간');

/**
 * 누적 검증 10건 도달 후 첫 줄에 정확도 표시 (점진적 노출).
 * 임계 미달이면 신규 발견만 표시.
 */
export const buildLlmInsightSlackMessage = async (
  userId: number,
  slot: InsightSlot,
  drafts: LlmInsightDraft[],
): Promise<LlmInsightSlackMessage> => {
  const slotLabel = formatSlotLabel(slot);
  const headerText = `${slotLabel} LLM 자율 발견 ${drafts.length}건`;

  const stats = await queryAccuracyStats(userId);

  const blocks: KnownBlock[] = [
    { type: 'header', text: { type: 'plain_text', text: headerText, emoji: false } },
  ];

  if (stats.totalVerified >= VERIFIED_THRESHOLD_FOR_DISCLOSURE) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `지난 검증 ${stats.totalVerified}건 중 ${stats.hit}건 적중 (${stats.hitRate ?? 0}%)`,
        },
      ],
    });
  }

  blocks.push({ type: 'divider' });

  const findingsLines = drafts.map((d, i) => {
    const verifyDays = d.verification.verifyAfterDays;
    return `*${i + 1}. ${d.signal}*\n_가설_: ${d.hypothesis}\n_도메인_: ${d.domains.join(', ')} · ${verifyDays}일 후 자동 검증`;
  });
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: findingsLines.join('\n\n') },
  });

  return { headerText, blocks };
};
