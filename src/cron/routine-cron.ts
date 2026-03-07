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
import { postBlockMessage, postToChannel } from '../shared/slack.js';
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
import {
  querySleepRecord,
  formatSleepDuration,
} from '../shared/sleep-notion.js';

interface RoutineCronConfig {
  dbId: string;
  channelId: string;
  llmClient?: LLMClient;
  sleepDbId?: string;
  schedules: {
    morning: string;
    lunch: string;
    evening: string;
    night: string;
  };
}

const RETRY_DELAY_MS = 1_000;

/** 1회 재시도 래퍼 (Notion API 호출용) */
const withRetry = async <T>(
  fn: () => Promise<T>,
  label: string,
): Promise<T> => {
  try {
    return await fn();
  } catch (firstError: unknown) {
    const msg = firstError instanceof Error ? firstError.message : String(firstError);
    // eslint-disable-next-line no-console
    console.warn(`[Routine Cron] ${label} 1차 실패, 재시도: ${msg}`);
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    return await fn();
  }
};

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

/** 아침 9시: 오늘 기록 생성 + 아침 체크리스트 전송 (재시도 + all-or-nothing) */
const morningTask = async (
  app: App,
  notionClient: NotionClient,
  config: RoutineCronConfig,
): Promise<void> => {
  const today = getTodayISO();

  // 1. 조회 (재시도 포함)
  const templates = await withRetry(
    () => queryRoutineTemplates(notionClient, config.dbId),
    '템플릿 조회',
  );
  const existingRecords = await withRetry(
    () => queryTodayRoutineRecords(notionClient, config.dbId, today),
    '기존 기록 조회',
  );
  const existingKeys = new Set(existingRecords.map((r) => `${r.title}:${r.timeSlot}`));

  const candidates = templates.filter(
    (t) => !existingKeys.has(`${t.title}:${t.timeSlot}`),
  );

  // 2. 빈도 체크 (재시도 포함)
  const newTemplates = [];
  for (const t of candidates) {
    if (t.frequency === '매일') {
      newTemplates.push(t);
    } else {
      const lastDate = await withRetry(
        () => queryLastRecordDate(notionClient, config.dbId, t.title, t.timeSlot),
        `빈도 조회: ${t.title}`,
      );
      if (shouldCreateToday(t.frequency, lastDate, today)) {
        newTemplates.push(t);
      }
    }
  }

  // 3. 기록 생성 (all-or-nothing: 하나라도 실패하면 에러 알림)
  const createdRecords = [];
  let creationFailed = false;
  for (const template of newTemplates) {
    try {
      const record = await withRetry(
        () => createRoutineRecord(
          notionClient,
          config.dbId,
          template.title,
          template.timeSlot,
          today,
          template.frequency,
        ),
        `기록 생성: ${template.title}`,
      );
      createdRecords.push(record);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[Routine Cron] 기록 생성 최종 실패 (${template.title}): ${msg}`);
      creationFailed = true;
      break;
    }
  }

  if (creationFailed) {
    await postToChannel(
      app.client, config.channelId,
      '루틴 기록 생성 중 오류가 발생했어. 잠시 후 다시 확인해줘.',
    );
    return;
  }

  // 4. 수면 기록 메시지 (루틴보다 먼저 전송)
  if (config.sleepDbId) {
    try {
      const yesterday = getYesterdayISO();
      const sleepRecord = await querySleepRecord(notionClient, config.sleepDbId, yesterday);

      if (sleepRecord) {
        const duration = formatSleepDuration(sleepRecord.durationMinutes);
        await postToChannel(
          app.client, config.channelId,
          `어제 수면: ${sleepRecord.bedtime}~${sleepRecord.wakeTime} (${duration})`,
        );
      } else {
        await postToChannel(
          app.client, config.channelId,
          `어제 잠은 잘 잤어? 수면 기록 남기자~ (예: "12시에 자서 7시에 일어났어")`,
        );
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      // eslint-disable-next-line no-console
      console.warn(`[Routine Cron] 수면 기록 조회 실패: ${msg}`);
    }
  }

  // 5. 루틴 체크리스트 메시지 전송
  const allRecords = [...existingRecords, ...createdRecords];
  const morningRecords = allRecords.filter((r) => r.timeSlot === '아침');

  if (morningRecords.length > 0) {
    const yesterday = getYesterdayISO();
    const yesterdayRecords = await withRetry(
      () => queryTodayRoutineRecords(notionClient, config.dbId, yesterday),
      '어제 기록 조회',
    );

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

    // 수면 기록 요약 추가
    if (config.sleepDbId) {
      try {
        const todaySleep = await querySleepRecord(notionClient, config.sleepDbId, today);
        if (todaySleep) {
          const duration = formatSleepDuration(todaySleep.durationMinutes);
          blocks.push({
            type: 'section',
            text: { type: 'mrkdwn', text: `오늘 수면: ${todaySleep.bedtime}~${todaySleep.wakeTime} (${duration})` },
          });
        }
      } catch {
        // 수면 조회 실패는 무시
      }
    }

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
        // 사용자에게 에러 알림
        try {
          await postToChannel(
            app.client, config.channelId,
            `${label} 알림 처리 중 오류가 발생했어. 잠시 후 다시 확인해줘.`,
          );
        } catch {
          console.error(`[Routine Cron] ${label} 에러 알림 전송도 실패`);
        }
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
