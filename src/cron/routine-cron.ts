import cron from 'node-cron';
import type { App } from '@slack/bolt';
import type { Client as NotionClient } from '@notionhq/client';
import {
  queryRoutineTemplates,
  queryTodayRoutineRecords,
  createRoutineRecord,
} from '../shared/routine-notion.js';
import { postBlockMessage } from '../shared/slack.js';
import {
  buildFilteredRoutineBlocks,
  buildNightSummaryBlocks,
} from '../agents/routine/blocks.js';

interface RoutineCronConfig {
  dbId: string;
  channelId: string;
  schedules: {
    morning: string;
    lunch: string;
    evening: string;
    night: string;
  };
}

/** KST(UTC+9) 기준 오늘 날짜 (YYYY-MM-DD) */
const getTodayISO = (): string => {
  const now = new Date();
  const kst = new Date(now.getTime() + (now.getTimezoneOffset() + 540) * 60_000);
  const yyyy = kst.getFullYear();
  const mm = String(kst.getMonth() + 1).padStart(2, '0');
  const dd = String(kst.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

/** 아침 9시: 오늘 기록 생성 + 아침 체크리스트 전송 */
const morningTask = async (
  app: App,
  notionClient: NotionClient,
  config: RoutineCronConfig,
): Promise<void> => {
  const today = getTodayISO();

  const templates = await queryRoutineTemplates(notionClient, config.dbId);
  const existingRecords = await queryTodayRoutineRecords(notionClient, config.dbId, today);
  const existingKeys = new Set(existingRecords.map((r) => `${r.title}:${r.timeSlot}`));

  const newTemplates = templates.filter(
    (t) => !existingKeys.has(`${t.title}:${t.timeSlot}`),
  );

  for (const template of newTemplates) {
    await createRoutineRecord(
      notionClient,
      config.dbId,
      template.title,
      template.timeSlot,
      today,
    );
  }

  const allRecords = await queryTodayRoutineRecords(notionClient, config.dbId, today);
  const morningRecords = allRecords.filter((r) => r.timeSlot === '아침');

  if (morningRecords.length > 0) {
    const { text, blocks } = buildFilteredRoutineBlocks(allRecords, today, ['아침']);
    await postBlockMessage(app.client, config.channelId, text, blocks);
  }

  // eslint-disable-next-line no-console
  console.log(`[Routine Cron] 아침 알림 전송 완료 (기록 ${newTemplates.length}개 생성)`);
};

/** 점심 1시: 미완료 아침 포함 + 점심 체크리스트 전송 */
const lunchTask = async (
  app: App,
  notionClient: NotionClient,
  config: RoutineCronConfig,
): Promise<void> => {
  const today = getTodayISO();
  const records = await queryTodayRoutineRecords(notionClient, config.dbId, today);

  const hasItems = records.some(
    (r) => r.timeSlot === '점심' || (r.timeSlot === '아침' && !r.completed),
  );

  if (hasItems) {
    const { text, blocks } = buildFilteredRoutineBlocks(
      records, today, ['점심'], ['아침'],
    );
    await postBlockMessage(app.client, config.channelId, text, blocks);
  }

  // eslint-disable-next-line no-console
  console.log(`[Routine Cron] 점심 알림 전송 완료`);
};

/** 저녁 6시: 미완료 아침/점심 포함 + 저녁 체크리스트 전송 */
const eveningTask = async (
  app: App,
  notionClient: NotionClient,
  config: RoutineCronConfig,
): Promise<void> => {
  const today = getTodayISO();
  const records = await queryTodayRoutineRecords(notionClient, config.dbId, today);

  const hasItems = records.some(
    (r) =>
      r.timeSlot === '저녁' ||
      ((r.timeSlot === '아침' || r.timeSlot === '점심') && !r.completed),
  );

  if (hasItems) {
    const { text, blocks } = buildFilteredRoutineBlocks(
      records, today, ['저녁'], ['아침', '점심'],
    );
    await postBlockMessage(app.client, config.channelId, text, blocks);
  }

  // eslint-disable-next-line no-console
  console.log(`[Routine Cron] 저녁 알림 전송 완료`);
};

/** 밤 11시: 전체 요약 + 마무리 메시지 */
const nightTask = async (
  app: App,
  notionClient: NotionClient,
  config: RoutineCronConfig,
): Promise<void> => {
  const today = getTodayISO();
  const records = await queryTodayRoutineRecords(notionClient, config.dbId, today);

  if (records.length > 0) {
    const { text, blocks } = buildNightSummaryBlocks(records, today);
    await postBlockMessage(app.client, config.channelId, text, blocks);
  }

  // eslint-disable-next-line no-console
  console.log(`[Routine Cron] 밤 요약 전송 완료`);
};

export const initRoutineCron = (
  app: App,
  notionClient: NotionClient,
  config: RoutineCronConfig,
): void => {
  const timezone = 'Asia/Seoul';
  const { schedules } = config;

  const wrapTask = (
    taskFn: (app: App, client: NotionClient, config: RoutineCronConfig) => Promise<void>,
    label: string,
  ): (() => Promise<void>) => {
    return async () => {
      try {
        await taskFn(app, notionClient, config);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[Routine Cron] ${label} 실패:`, msg);
      }
    };
  };

  cron.schedule(schedules.morning, wrapTask(morningTask, '아침'), { timezone });
  cron.schedule(schedules.lunch, wrapTask(lunchTask, '점심'), { timezone });
  cron.schedule(schedules.evening, wrapTask(eveningTask, '저녁'), { timezone });
  cron.schedule(schedules.night, wrapTask(nightTask, '밤'), { timezone });

  // eslint-disable-next-line no-console
  console.log(
    `[Routine Cron] 알림 스케줄 등록: ${schedules.morning}, ${schedules.lunch}, ${schedules.evening}, ${schedules.night}`,
  );
};
