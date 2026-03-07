import cron from 'node-cron';
import type { App } from '@slack/bolt';
import type { LLMClient } from '../shared/llm.js';
import type { NotionClient } from '../shared/notion.js';
import { queryTodaySchedules } from '../shared/notion.js';
import { postToChannel, postBlockMessage } from '../shared/slack.js';
import {
  formatDateShort,
  generateScheduleGreeting,
  getFallbackGreeting,
} from './schedule-reminder.js';
import type { TimeOfDay } from './schedule-reminder.js';
import { buildScheduleBlocks } from '../agents/schedule/blocks.js';

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

      // 인사 생성 (LLM 또는 하드코딩 폴백)
      const greeting = config.llmClient
        ? await generateScheduleGreeting(config.llmClient, timeOfDay, items, today, formatted)
        : getFallbackGreeting(timeOfDay, items, today, formatted);

      if (items.length === 0) {
        // 일정 없으면 plain text 인사만
        await postToChannel(app.client, config.channelId, greeting);
      } else {
        // 일정 있으면 Block Kit + overflow 메뉴
        const { text, blocks } = buildScheduleBlocks(items, today, greeting);
        await postBlockMessage(app.client, config.channelId, text, blocks);
      }
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
