import { App } from '@slack/bolt';
import { CONFIG } from './shared/config.js';
import { registerMessageHandler, registerAgent } from './router.js';
import { connectMCP, disconnectMCP } from './shared/mcp-client.js';
import { createLLMClient } from './shared/llm.js';
import { createScheduleAgent } from './agents/schedule/index.js';
import { createRoutineAgent } from './agents/routine/index.js';
import { registerRoutineActions } from './agents/routine/actions.js';
import { createNotionClient } from './shared/notion.js';
import { initCronJobs } from './cron/index.js';
import { initRoutineCron } from './cron/routine-cron.js';

const app = new App({
  token: CONFIG.slack.botToken,
  signingSecret: CONFIG.slack.signingSecret,
  appToken: CONFIG.slack.appToken,
  socketMode: true,
});

registerMessageHandler(app);

const startApp = async (): Promise<void> => {
  await connectMCP(CONFIG.notion.apiKey);

  const llmClient = await createLLMClient();
  const notionClient = createNotionClient(CONFIG.notion.apiKey);

  // Schedule Agent
  const scheduleAgent = createScheduleAgent(llmClient, CONFIG.notion.scheduleDbId, notionClient);
  registerAgent(CONFIG.channels.schedule, scheduleAgent);

  // Routine Agent
  const routineAgent = createRoutineAgent(llmClient, CONFIG.notion.routineDbId, notionClient);
  registerAgent(CONFIG.channels.routine, routineAgent);
  registerRoutineActions(app, notionClient, CONFIG.notion.routineDbId);

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
  process.exit(0);
};

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

startApp().catch((error: unknown) => {
  console.error('[App] 시작 실패:', error);
  process.exit(1);
});
