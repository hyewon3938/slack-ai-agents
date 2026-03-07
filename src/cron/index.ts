import cron from 'node-cron';
import type { App } from '@slack/bolt';
import type { LLMClient } from '../shared/llm.js';
import type { NotionClient } from '../shared/notion.js';
import { queryTodaySchedules } from '../shared/notion.js';
import { postToChannel } from '../shared/slack.js';
import {
  formatDateShort,
  buildReminderMessage,
  generateScheduleGreeting,
  buildReminderWithGreeting,
} from './schedule-reminder.js';
import type { TimeOfDay } from './schedule-reminder.js';

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
  llmClient?: LLMClient;
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
  timeOfDay: TimeOfDay,
): (() => Promise<void>) => {
  return async () => {
    try {
      const today = getTodayISO();
      const formatted = formatDateShort(today);
      const items = await queryTodaySchedules(notionClient, config.dbId, today);

      let message: string;

      if (config.llmClient) {
        // LLM 인사 생성 (실패 시 내부 폴백)
        const greeting = await generateScheduleGreeting(
          config.llmClient, timeOfDay, items, today, formatted,
        );
        message = buildReminderWithGreeting(greeting, items);
      } else {
        // LLM 없으면 기존 하드코딩 방식
        const isNight = timeOfDay === 'night';
        message = buildReminderMessage(items, today, formatted, isNight);
      }

      await postToChannel(app.client, config.channelId, message);
      // eslint-disable-next-line no-console
      console.log(`[Cron] 알림 전송 완료 (${timeOfDay}, ${formatted})`);
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

  cron.schedule(schedules.morning, createReminderTask(app, notionClient, config, 'morning'), { timezone });
  cron.schedule(schedules.lunch, createReminderTask(app, notionClient, config, 'lunch'), { timezone });
  cron.schedule(schedules.evening, createReminderTask(app, notionClient, config, 'evening'), { timezone });
  cron.schedule(schedules.night, createReminderTask(app, notionClient, config, 'night'), { timezone });

  // eslint-disable-next-line no-console
  console.log(
    `[Cron] 알림 스케줄 등록: ${schedules.morning}, ${schedules.lunch}, ${schedules.evening}, ${schedules.night}`,
  );

};
