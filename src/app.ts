import { App } from '@slack/bolt';
import { CONFIG } from './shared/config.js';
import { registerMessageHandler } from './router.js';

const app = new App({
  token: CONFIG.slack.botToken,
  signingSecret: CONFIG.slack.signingSecret,
  appToken: CONFIG.slack.appToken,
  socketMode: true,
});

registerMessageHandler(app);

const startApp = async (): Promise<void> => {
  await app.start();
  // eslint-disable-next-line no-console
  console.log('[App] Slack bot is running in Socket Mode');
};

startApp().catch((error: unknown) => {
  console.error('[App] Failed to start:', error);
  process.exit(1);
});
