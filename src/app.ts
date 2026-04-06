import { App } from '@slack/bolt';
import { CONFIG } from './shared/config.js';
import { registerMessageHandler, registerAgent } from './router.js';
import { connectDB, disconnectDB } from './shared/db.js';
import { runMigrations } from './shared/migrate.js';
import { createLLMClient, createCronLLMClient } from './shared/llm.js';
import { createLifeAgent } from './agents/life/index.js';
import { registerLifeActions } from './agents/life/actions.js';
import { registerHomeTab } from './agents/life/home.js';
import { createInsightAgent } from './agents/insight/index.js';
import { createMoneyAgent } from './agents/money/index.js';
import { CronScheduler } from './cron/life-cron.js';
import { setPostModifyHook } from './shared/sql-tools.js';

const app = new App({
  token: CONFIG.slack.botToken,
  signingSecret: CONFIG.slack.signingSecret,
  appToken: CONFIG.slack.appToken,
  socketMode: true,
});

registerMessageHandler(app);

const startApp = async (): Promise<void> => {
  // DB 연결 + 마이그레이션
  await connectDB(CONFIG.db.url);
  await runMigrations();

  const llmClient = await createLLMClient();
  const cronLLMClient = await createCronLLMClient();

  // Life Agent
  const lifeAgent = createLifeAgent(llmClient);
  registerAgent(CONFIG.channels.life, lifeAgent);
  registerLifeActions(app);
  registerHomeTab(app);

  // Insight Agent (#insight 채널 — 명리학 일운 + 일기/고민)
  if (CONFIG.channels.insight) {
    const insightAgent = createInsightAgent(llmClient);
    registerAgent(CONFIG.channels.insight, insightAgent);
  }

  // Money Agent (#money 채널 — 지출/예산 관리)
  if (CONFIG.channels.money) {
    const moneyAgent = createMoneyAgent(llmClient);
    registerAgent(CONFIG.channels.money, moneyAgent);
  }

  // 크론 스케줄러 (DB 기반 동적 스케줄) — Gemini Flash로 비용 절감
  const cronScheduler = new CronScheduler(app, {
    channelId: CONFIG.channels.life,
    llmClient: cronLLMClient,
  });
  await cronScheduler.init();

  // SQL modify_db 후 알림 설정 변경 감지 → 크론 리스케줄 (debounce 내장)
  setPostModifyHook((sql: string) => {
    if (/\bnotification_settings\b/i.test(sql)) {
      cronScheduler.reload();
    }
  });

  await app.start();
  // eslint-disable-next-line no-console
  console.log('[App] Slack 봇이 Socket Mode로 실행 중입니다');
};

const shutdown = async (): Promise<void> => {
  // eslint-disable-next-line no-console
  console.log('[App] 종료 중...');
  await disconnectDB();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

startApp().catch((error: unknown) => {
  console.error('[App] 시작 실패:', error);
  process.exit(1);
});
