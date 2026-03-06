import { App } from '@slack/bolt';
import { CONFIG } from './shared/config.js';
import { registerMessageHandler, registerAgent } from './router.js';
import { connectMCP, disconnectMCP } from './shared/mcp-client.js';
import { createLLMClient } from './shared/llm.js';
import { createScheduleAgent } from './agents/schedule/index.js';

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
  const scheduleAgent = createScheduleAgent(llmClient, CONFIG.notion.scheduleDbId);
  registerAgent(CONFIG.channels.schedule, scheduleAgent);

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
