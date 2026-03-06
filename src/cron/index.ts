import cron from 'node-cron';
import type { App } from '@slack/bolt';
import type { NotionClient } from '../shared/notion.js';
import { queryTodaySchedules } from '../shared/notion.js';
import { postToChannel } from '../shared/slack.js';
import { buildReminderMessage, formatDateShort } from './schedule-reminder.js';

/** KST(UTC+9) 기준 현재 시각 */
const getKSTDate = (): Date => {
  const now = new Date();
  return new Date(now.getTime() + (now.getTimezoneOffset() + 540) * 60_000);
};

const getTodayISO = (): string => {
  const now = getKSTDate();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

interface CronConfig {
  dbId: string;
  channelId: string;
  schedules: {
    morning: string;
    lunch: string;
    evening: string;
    night: string;
  };
}

const createReminderTask = (
  app: App,
  notionClient: NotionClient,
  config: CronConfig,
  isNight: boolean,
): (() => Promise<void>) => {
  return async () => {
    try {
      const today = getTodayISO();
      const formatted = formatDateShort(today);
      const items = await queryTodaySchedules(notionClient, config.dbId, today);
      const message = buildReminderMessage(items, today, formatted, isNight);

      await postToChannel(app.client, config.channelId, message);
      // eslint-disable-next-line no-console
      console.log(`[Cron] 알림 전송 완료 (${isNight ? 'night' : 'reminder'}, ${formatted})`);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[Cron] 알림 전송 실패:`, msg);
    }
  };
};

export const initCronJobs = (
  app: App,
  notionClient: NotionClient,
  config: CronConfig,
): void => {
  const timezone = 'Asia/Seoul';
  const { schedules } = config;

  const reminder = createReminderTask(app, notionClient, config, false);
  const nightReminder = createReminderTask(app, notionClient, config, true);

  cron.schedule(schedules.morning, reminder, { timezone });
  cron.schedule(schedules.lunch, reminder, { timezone });
  cron.schedule(schedules.evening, reminder, { timezone });
  cron.schedule(schedules.night, nightReminder, { timezone });

  // eslint-disable-next-line no-console
  console.log(
    `[Cron] 알림 스케줄 등록: ${schedules.morning}, ${schedules.lunch}, ${schedules.evening}, ${schedules.night}`,
  );

};
