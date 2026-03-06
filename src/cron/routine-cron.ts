import cron from 'node-cron';
import type { App } from '@slack/bolt';
import type { Client as NotionClient } from '@notionhq/client';
import type { LLMClient } from '../shared/llm.js';
import {
  queryRoutineTemplates,
  queryTodayRoutineRecords,
  queryLastRecordDate,
  createRoutineRecord,
  shouldCreateToday,
} from '../shared/routine-notion.js';
import { postBlockMessage } from '../shared/slack.js';
import {
  buildFilteredRoutineBlocks,
  buildMorningGreetingBlocks,
  buildNightSummaryBlocks,
  buildTextBlocks,
} from '../agents/routine/blocks.js';
import {
  generateMorningGreeting,
  generateNightSummary,
} from '../agents/routine/greeting.js';

interface RoutineCronConfig {
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

/** KST(UTC+9) 기준 오늘 날짜 (YYYY-MM-DD) */
const getTodayISO = (): string => {
  const now = new Date();
  const kst = new Date(now.getTime() + (now.getTimezoneOffset() + 540) * 60_000);
  const yyyy = kst.getFullYear();
  const mm = String(kst.getMonth() + 1).padStart(2, '0');
  const dd = String(kst.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

/** KST 기준 어제 날짜 (YYYY-MM-DD) */
const getYesterdayISO = (): string => {
  const now = new Date();
  const kst = new Date(now.getTime() + (now.getTimezoneOffset() + 540) * 60_000);
  kst.setDate(kst.getDate() - 1);
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

  const candidates = templates.filter(
    (t) => !existingKeys.has(`${t.title}:${t.timeSlot}`),
  );

  // 빈도 체크: 매일이 아닌 템플릿은 마지막 기록 날짜 기준으로 판별
  const newTemplates = [];
  for (const t of candidates) {
    if (t.frequency === '매일') {
      newTemplates.push(t);
    } else {
      const lastDate = await queryLastRecordDate(notionClient, config.dbId, t.title, t.timeSlot);
      if (shouldCreateToday(t.frequency, lastDate, today)) {
        newTemplates.push(t);
      }
    }
  }

  const createdRecords = [];
  for (const template of newTemplates) {
    const record = await createRoutineRecord(
      notionClient,
      config.dbId,
      template.title,
      template.timeSlot,
      today,
      template.frequency,
    );
    createdRecords.push(record);
  }

  // search 재조회 대신 기존 + 신규 레코드를 직접 합침 (eventual consistency 회피)
  const allRecords = [...existingRecords, ...createdRecords];
  const morningRecords = allRecords.filter((r) => r.timeSlot === '아침');

  if (morningRecords.length > 0) {
    // 어제 완료율 조회 → 인사 블록 생성
    const yesterday = getYesterdayISO();
    const yesterdayRecords = await queryTodayRoutineRecords(notionClient, config.dbId, yesterday);

    // LLM 인사 생성 (실패 시 하드코딩 폴백)
    let greetingBlocks;
    if (config.llmClient) {
      const greetingText = await generateMorningGreeting(config.llmClient, yesterdayRecords);
      greetingBlocks = buildTextBlocks(greetingText);
    } else {
      greetingBlocks = buildMorningGreetingBlocks(yesterdayRecords);
    }

    const { text, blocks } = buildFilteredRoutineBlocks(allRecords, today, ['아침']);
    const fullBlocks = [...greetingBlocks, ...blocks];
    await postBlockMessage(app.client, config.channelId, text, fullBlocks);
    // eslint-disable-next-line no-console
    console.log(`[Routine Cron] 아침 알림 전송 완료 (기록 ${createdRecords.length}개 생성)`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`[Routine Cron] 아침 루틴 없음 — 메시지 미전송`);
  }
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
    // eslint-disable-next-line no-console
    console.log(`[Routine Cron] 점심 알림 전송 완료`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`[Routine Cron] 점심 루틴 없음 — 메시지 미전송`);
  }
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
    // eslint-disable-next-line no-console
    console.log(`[Routine Cron] 저녁 알림 전송 완료`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`[Routine Cron] 저녁 루틴 없음 — 메시지 미전송`);
  }
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
    // LLM 밤 요약 생성 (실패 시 하드코딩 폴백)
    let summaryText: string | undefined;
    if (config.llmClient) {
      summaryText = await generateNightSummary(config.llmClient, records);
    }

    const { text, blocks } = buildNightSummaryBlocks(records, today, summaryText);
    await postBlockMessage(app.client, config.channelId, text, blocks);
    // eslint-disable-next-line no-console
    console.log(`[Routine Cron] 밤 요약 전송 완료`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`[Routine Cron] 밤 기록 없음 — 메시지 미전송`);
  }
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
