import { App } from '@slack/bolt';
import { CONFIG } from './shared/config.js';
import { registerMessageHandler, registerAgent } from './router.js';
import { connectMCP, disconnectMCP } from './shared/mcp-client.js';
import { connectDB, disconnectDB } from './shared/db.js';
import { runMigrations } from './shared/migrate.js';
import { createLLMClient } from './shared/llm.js';
import { createScheduleAgent } from './agents/schedule/index.js';
import { createRoutineAgent } from './agents/routine/index.js';
import { registerRoutineActions } from './agents/routine/actions.js';
import { registerScheduleActions } from './agents/schedule/actions.js';
import { createNotionClient } from './shared/notion.js';
import { createLifeAgent } from './agents/life/index.js';
import { registerLifeActions } from './agents/life/actions.js';
import { initCronJobs } from './cron/index.js';
import { initRoutineCron } from './cron/routine-cron.js';
import { initLifeCron } from './cron/life-cron.js';

const app = new App({
  token: CONFIG.slack.botToken,
  signingSecret: CONFIG.slack.signingSecret,
  appToken: CONFIG.slack.appToken,
  socketMode: true,
});

registerMessageHandler(app);

const startApp = async (): Promise<void> => {
  // DB 연결 + 마이그레이션 (가장 먼저)
  await connectDB(CONFIG.db.url);
  await runMigrations();

  await connectMCP(CONFIG.notion.apiKey);

  const llmClient = await createLLMClient();
  const notionClient = createNotionClient(CONFIG.notion.apiKey);

  // Schedule Agent
  const scheduleAgent = createScheduleAgent(llmClient, CONFIG.notion.scheduleDbId, notionClient);
  registerAgent(CONFIG.channels.schedule, scheduleAgent);
  registerScheduleActions(app, notionClient, CONFIG.notion.scheduleDbId);

  // Routine Agent
  const routineAgent = createRoutineAgent(
    llmClient, CONFIG.notion.routineDbId, notionClient,
    CONFIG.notion.sleepDbId || undefined,
  );
  registerAgent(CONFIG.channels.routine, routineAgent);
  registerRoutineActions(app, notionClient, CONFIG.notion.routineDbId);

  // v2 Life Agent (LIFE_CHANNEL_ID 설정 시)
  if (CONFIG.channels.life) {
    const lifeAgent = createLifeAgent(llmClient);
    registerAgent(CONFIG.channels.life, lifeAgent);
    registerLifeActions(app);
    initLifeCron(app, {
      channelId: CONFIG.channels.life,
      schedules: CONFIG.lifeCron,
    });
    // eslint-disable-next-line no-console
    console.log('[App] Life Agent (v2) + Cron 등록 완료');
  }

  // Cron Jobs
  initCronJobs(app, notionClient, {
    dbId: CONFIG.notion.scheduleDbId,
    channelId: CONFIG.channels.schedule,
    llmClient,
    schedules: CONFIG.cron,
  });

  initRoutineCron(app, notionClient, {
    dbId: CONFIG.notion.routineDbId,
    channelId: CONFIG.channels.routine,
    llmClient,
    sleepDbId: CONFIG.notion.sleepDbId || undefined,
    schedules: CONFIG.routineCron,
  });

  await app.start();
  // eslint-disable-next-line no-console
  console.log('[App] Slack 봇이 Socket Mode로 실행 중입니다');
};

const shutdown = async (): Promise<void> => {
  // eslint-disable-next-line no-console
  console.log('[App] 종료 중...');
  await disconnectMCP();
  await disconnectDB();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

startApp().catch((error: unknown) => {
  console.error('[App] 시작 실패:', error);
  process.exit(1);
});
