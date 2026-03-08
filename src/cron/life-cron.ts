/**
 * v2 크론 오케스트레이터.
 * SQL 기반 루틴 자동 생성 + 체크리스트/일정 알림.
 * LLM 인사 없음 (하드코딩 메시지만).
 */

import cron from 'node-cron';
import type { App } from '@slack/bolt';
import {
  queryActiveTemplates,
  queryTodayRecords,
  queryExistingTemplateIds,
  queryLastRecordDate,
  createRecord,
  shouldCreateToday,
  queryTodaySchedules,
} from '../shared/life-queries.js';
import { postBlockMessage, postToChannel } from '../shared/slack.js';
import {
  buildFilteredRoutineBlocks,
  buildMorningGreetingBlocks,
  buildNightSummaryBlocks,
  buildScheduleBlocks,
} from '../agents/life/blocks.js';

export interface LifeCronConfig {
  channelId: string;
  schedules: {
    morning: string;
    lunch: string;
    evening: string;
    night: string;
  };
}

// ─── KST 날짜 헬퍼 ─────────────────────────────────────

/** KST(UTC+9) 기준 오늘 날짜 (YYYY-MM-DD) */
const getTodayISO = (): string => {
  const now = new Date();
  const kst = new Date(now.getTime() + (now.getTimezoneOffset() + 540) * 60_000);
  const yyyy = kst.getFullYear();
  const mm = String(kst.getMonth() + 1).padStart(2, '0');
  const dd = String(kst.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

/** KST 기준 어제 날짜 */
const getYesterdayISO = (): string => {
  const now = new Date();
  const kst = new Date(now.getTime() + (now.getTimezoneOffset() + 540) * 60_000);
  kst.setDate(kst.getDate() - 1);
  const yyyy = kst.getFullYear();
  const mm = String(kst.getMonth() + 1).padStart(2, '0');
  const dd = String(kst.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

// ─── 루틴 기록 생성 ─────────────────────────────────────

/** 활성 템플릿 → 빈도 체크 → 오늘 기록 생성 */
const createTodayRecords = async (today: string): Promise<number> => {
  const templates = await queryActiveTemplates();
  const existingIds = await queryExistingTemplateIds(today);

  const candidates = templates.filter((t) => !existingIds.has(t.id));

  let created = 0;
  for (const t of candidates) {
    let shouldCreate = false;

    if (t.frequency === '매일') {
      shouldCreate = true;
    } else {
      const lastDate = await queryLastRecordDate(t.id);
      shouldCreate = shouldCreateToday(t.frequency, lastDate, today);
    }

    if (shouldCreate) {
      try {
        await createRecord(t.id, today);
        created++;
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[Life Cron] 기록 생성 실패 (${t.name}): ${msg}`);
      }
    }
  }

  return created;
};

// ─── 크론 태스크 ────────────────────────────────────────

/** 아침 9시: 기록 생성 + 어제 완료율 + 아침 체크리스트 + 일정 */
const morningTask = async (
  app: App,
  config: LifeCronConfig,
): Promise<void> => {
  const today = getTodayISO();
  const yesterday = getYesterdayISO();

  // 1. 오늘 기록 생성
  const created = await createTodayRecords(today);

  // 2. 어제 완료율 블록
  const yesterdayRecords = await queryTodayRecords(yesterday);
  const greetingBlocks = buildMorningGreetingBlocks(yesterdayRecords);

  // 3. 오늘 루틴 체크리스트 (아침 시간대)
  const todayRecords = await queryTodayRecords(today);
  const morningRecords = todayRecords.filter((r) => r.time_slot === '아침');

  if (morningRecords.length > 0) {
    const { text, blocks } = buildFilteredRoutineBlocks(todayRecords, today, ['아침']);
    const fullBlocks = [...greetingBlocks, ...blocks];
    await postBlockMessage(app.client, config.channelId, text, fullBlocks);
  } else if (greetingBlocks.length > 0) {
    // 아침 루틴은 없지만 어제 요약은 전송
    await postBlockMessage(app.client, config.channelId, '어제 루틴 요약', greetingBlocks);
  }

  // 4. 오늘 일정 (있으면 전송)
  const schedules = await queryTodaySchedules(today);
  if (schedules.length > 0) {
    const { text, blocks } = buildScheduleBlocks(schedules, today);
    await postBlockMessage(app.client, config.channelId, text, blocks);
  }

  // eslint-disable-next-line no-console
  console.log(`[Life Cron] 아침 알림 완료 (기록 ${created}개 생성)`);
};

/** 점심 1시: 미완료 아침 + 점심 체크리스트 */
const lunchTask = async (
  app: App,
  config: LifeCronConfig,
): Promise<void> => {
  const today = getTodayISO();
  const records = await queryTodayRecords(today);

  const hasItems = records.some(
    (r) => r.time_slot === '점심' || (r.time_slot === '아침' && !r.completed),
  );

  if (hasItems) {
    const { text, blocks } = buildFilteredRoutineBlocks(
      records, today, ['점심'], ['아침'],
    );
    await postBlockMessage(app.client, config.channelId, text, blocks);
    // eslint-disable-next-line no-console
    console.log(`[Life Cron] 점심 알림 전송 완료`);
  }
};

/** 저녁 6시: 미완료 아침/점심 + 저녁 체크리스트 */
const eveningTask = async (
  app: App,
  config: LifeCronConfig,
): Promise<void> => {
  const today = getTodayISO();
  const records = await queryTodayRecords(today);

  const hasItems = records.some(
    (r) =>
      r.time_slot === '저녁' ||
      ((r.time_slot === '아침' || r.time_slot === '점심') && !r.completed),
  );

  if (hasItems) {
    const { text, blocks } = buildFilteredRoutineBlocks(
      records, today, ['저녁'], ['아침', '점심'],
    );
    await postBlockMessage(app.client, config.channelId, text, blocks);
    // eslint-disable-next-line no-console
    console.log(`[Life Cron] 저녁 알림 전송 완료`);
  }
};

/** 밤 10시: 전체 요약 + 마무리 */
const nightTask = async (
  app: App,
  config: LifeCronConfig,
): Promise<void> => {
  const today = getTodayISO();
  const records = await queryTodayRecords(today);

  if (records.length > 0) {
    const { text, blocks } = buildNightSummaryBlocks(records, today);
    await postBlockMessage(app.client, config.channelId, text, blocks);
    // eslint-disable-next-line no-console
    console.log(`[Life Cron] 밤 요약 전송 완료`);
  }

  // 일정 요약 (미완료 있으면)
  const schedules = await queryTodaySchedules(today);
  const hasIncomplete = schedules.some(
    (s) => s.category !== '약속' && s.status !== 'done' && s.status !== 'cancelled',
  );

  if (hasIncomplete) {
    const { text, blocks } = buildScheduleBlocks(schedules, today);
    await postBlockMessage(app.client, config.channelId, text, blocks);
  }
};

// ─── 크론 등록 ──────────────────────────────────────────

const wrapTask = (
  taskFn: (app: App, config: LifeCronConfig) => Promise<void>,
  app: App,
  config: LifeCronConfig,
  label: string,
): (() => Promise<void>) => {
  return async () => {
    try {
      await taskFn(app, config);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[Life Cron] ${label} 실패:`, msg);
      try {
        await postToChannel(
          app.client, config.channelId,
          `${label} 알림 처리 중 오류가 발생했어. 잠시 후 다시 확인해줘.`,
        );
      } catch {
        console.error(`[Life Cron] ${label} 에러 알림 전송도 실패`);
      }
    }
  };
};

export const initLifeCron = (
  app: App,
  config: LifeCronConfig,
): void => {
  const timezone = 'Asia/Seoul';
  const { schedules } = config;

  cron.schedule(schedules.morning, wrapTask(morningTask, app, config, '아침'), { timezone });
  cron.schedule(schedules.lunch, wrapTask(lunchTask, app, config, '점심'), { timezone });
  cron.schedule(schedules.evening, wrapTask(eveningTask, app, config, '저녁'), { timezone });
  cron.schedule(schedules.night, wrapTask(nightTask, app, config, '밤'), { timezone });

  // eslint-disable-next-line no-console
  console.log(
    `[Life Cron] 알림 스케줄 등록: ${schedules.morning}, ${schedules.lunch}, ${schedules.evening}, ${schedules.night}`,
  );
};
