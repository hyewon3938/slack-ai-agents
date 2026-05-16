/**
 * 프로액티브 인사이트 v2 Phase 2 — 월간 LLM 자율 발견 슬롯.
 * 매월 1일 09:30 실행. 1일 아닌 날은 early return.
 */

import type { App } from '@slack/bolt';
import type { LifeCronConfig } from './life-cron.js';
import { runAutonomousAnalysis, persistLlmInsights } from '../shared/llm-insights.js';
import { buildLlmInsightSlackMessage } from '../agents/life/llm-insight-fast-path.js';
import { postBlockMessage } from '../shared/slack.js';
import { getKSTDayOfMonth } from '../shared/kst.js';
import { DEFAULT_USER_ID, queryAllUserMappings } from '../shared/user-resolver.js';

export const monthlyLlmInsightTask = async (app: App, config: LifeCronConfig): Promise<void> => {
  if (getKSTDayOfMonth() !== 1) return;

  const mappings = await queryAllUserMappings();
  const targets =
    mappings.length > 0
      ? mappings.map((m) => ({
          userId: m.userId,
          channelId: m.lifeChannelId ?? m.slackUserId,
        }))
      : [{ userId: DEFAULT_USER_ID, channelId: process.env['LIFE_CHANNEL_ID'] ?? '' }];

  for (const target of targets) {
    if (!target.channelId) continue;
    try {
      const drafts = await runAutonomousAnalysis(config.llmClient, target.userId, 'monthly');
      if (drafts.length === 0) {
        console.warn(`[LLM Insight] 월간 발견 0건 (유저=${target.userId}) — 메시지 스킵`);
        continue;
      }
      await persistLlmInsights(target.userId, 'monthly', drafts);
      const { headerText, blocks } = await buildLlmInsightSlackMessage(
        target.userId,
        'monthly',
        drafts,
      );
      await postBlockMessage(app.client, target.channelId, headerText, blocks);
      console.warn(`[LLM Insight] 월간 발견 ${drafts.length}건 전송 (유저=${target.userId})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[LLM Insight] 월간 실패 (유저=${target.userId}): ${msg}`);
    }
  }
};
