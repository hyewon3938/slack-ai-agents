import type { App } from '@slack/bolt';
import type { LifeCronConfig } from '../life/types.js';
import { pickWeeklyInsights } from '../../shared/insights/pick.js';
import { getTodayISO, getKSTDayOfWeek, addDays, formatDateShort } from '../../shared/kst.js';
import { postBlockMessage } from '../../shared/slack.js';
import { DEFAULT_USER_ID, queryAllUserMappings } from '../../shared/user-resolver.js';
import { aggregateWeeklyReport } from './aggregate.js';
import { buildWeeklyReportBlocks } from './blocks.js';
import { generateWeeklySummary } from './summary.js';

// ─── 주간 리포트 크론 태스크 ────────────────────────────

export const weeklyReportTask = async (app: App, config: LifeCronConfig): Promise<void> => {
  // 월요일(1)만 실행 — 지난주 회고 시점
  if (getKSTDayOfWeek() !== 1) return;

  const today = getTodayISO();
  const weekStart = addDays(today, -7); // 지난주 월요일
  const weekEnd = addDays(today, -1); // 지난주 일요일
  const headerText = `지난주 리포트 (${formatDateShort(weekStart)} ~ ${formatDateShort(weekEnd)})`;

  const mappings = await queryAllUserMappings();

  const targets =
    mappings.length > 0
      ? mappings.map((m) => ({ userId: m.userId, channelId: m.lifeChannelId ?? m.slackUserId }))
      : [{ userId: DEFAULT_USER_ID, channelId: config.channelId }];

  for (const target of targets) {
    if (!target.channelId) continue;
    try {
      const data = await aggregateWeeklyReport(weekStart, weekEnd, target.userId);
      // 인사이트는 지난주 마지막 날 기준으로 추출
      const insights = await pickWeeklyInsights(weekEnd, target.userId);
      const summary = await generateWeeklySummary(config.llmClient, data, insights);
      const blocks = buildWeeklyReportBlocks(data, insights, summary);
      await postBlockMessage(app.client, target.channelId, headerText, blocks);
      console.warn(`[Life Cron] 주간 리포트 전송 완료 (유저=${target.userId})`);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[Life Cron] 주간 리포트 실패 (유저=${target.userId}): ${msg}`);
    }
  }
};
