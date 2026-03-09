/**
 * v4 크론 오케스트레이터.
 * DB(notification_settings)에서 스케줄 로드 → 동적 크론 등록.
 * 리마인더 체커: 매분 실행, reminders 테이블 조회 → 채널 전송.
 */

import cron from 'node-cron';
import type { App } from '@slack/bolt';
import type { LLMClient, LLMMessage } from '../shared/llm.js';
import type { RoutineRecordRow } from '../shared/life-queries.js';
import {
  queryActiveTemplates,
  queryTodayRecords,
  queryExistingTemplateIds,
  queryLastRecordDate,
  createRecord,
  shouldCreateToday,
  queryTodaySchedules,
  queryNightSleepExists,
  queryNotificationSettings,
  queryDueReminders,
  deactivateReminder,
} from '../shared/life-queries.js';
import { postBlockMessage, postToChannel } from '../shared/slack.js';
import { getTodayISO, getYesterdayISO, getKSTTimeString, getKSTDayOfWeek } from '../shared/kst.js';
import { CHARACTER_PROMPT } from '../shared/personality.js';
import {
  buildFilteredRoutineBlocks,
  buildMorningGreetingBlocks,
  buildNightSummaryBlocks,
  buildScheduleText,
  buildNightScheduleText,
  buildSleepReminderText,
  buildSleepRecordedText,
} from '../agents/life/blocks.js';

export interface LifeCronConfig {
  channelId: string;
  llmClient: LLMClient;
}

// ─── LLM 메시지 생성 ────────────────────────────────────

const CRON_SYSTEM_PROMPT = `너는 '잔소리꾼'. 사용자의 루틴과 일정을 관리하는 친구.
${CHARACTER_PROMPT}

지금 크론 알림 메시지를 생성해. 한두 문장으로 짧게.
- 데이터 기반으로 구체적이고 따뜻하게
- 시스템 설명 없이 친구처럼 자연스럽게`;

/** LLM으로 크론 메시지 생성 (실패 시 fallback) */
const generateCronMessage = async (
  llmClient: LLMClient,
  context: string,
  fallback: string,
): Promise<string> => {
  try {
    const messages: LLMMessage[] = [
      { role: 'system', content: CRON_SYSTEM_PROMPT },
      { role: 'user', content: context },
    ];
    const response = await llmClient.chat(messages);
    return response.text ?? fallback;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Life Cron] LLM 메시지 생성 실패:', msg);
    return fallback;
  }
};

// ─── 루틴 통계 ───────────────────────────────────────────

interface RoutineStats {
  total: number;
  completed: number;
  rate: number;
  slotBreakdown: Record<string, { total: number; completed: number; rate: number }>;
  weakestSlot: string | null;
}

export const calcRoutineStats = (records: RoutineRecordRow[]): RoutineStats => {
  const total = records.length;
  const completed = records.filter((r) => r.completed).length;
  const rate = total > 0 ? Math.round((completed / total) * 100) : 0;

  const slots: Record<string, { total: number; completed: number; rate: number }> = {};
  for (const r of records) {
    if (!slots[r.time_slot]) slots[r.time_slot] = { total: 0, completed: 0, rate: 0 };
    slots[r.time_slot]!.total++;
    if (r.completed) slots[r.time_slot]!.completed++;
  }
  for (const s of Object.values(slots)) {
    s.rate = s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0;
  }

  let weakestSlot: string | null = null;
  let minRate = 100;
  for (const [slot, stat] of Object.entries(slots)) {
    if (stat.rate < minRate) { minRate = stat.rate; weakestSlot = slot; }
  }
  if (minRate >= 70) weakestSlot = null;

  return { total, completed, rate, slotBreakdown: slots, weakestSlot };
};

// ─── 루틴 기록 생성 ─────────────────────────────────────

/** 활성 템플릿 → 빈도 체크 → 오늘 기록 생성 */
export const createTodayRecords = async (today: string): Promise<number> => {
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

/** 수면 기록 체크 — 기록 유무와 관계없이 항상 알림 전송 */
const sleepCheckTask = async (
  app: App,
  config: LifeCronConfig,
): Promise<void> => {
  const today = getTodayISO();
  const yesterday = getYesterdayISO();
  const hasRecord = await queryNightSleepExists(yesterday, today);

  const text = hasRecord ? buildSleepRecordedText('morning') : buildSleepReminderText('morning');
  await postToChannel(app.client, config.channelId, text);
  console.log(`[Life Cron] 수면 체크 알림 전송 (기록: ${hasRecord ? '있음' : '없음'})`);
};

/** 오늘 일정 텍스트 알림 */
const morningScheduleTask = async (
  app: App,
  config: LifeCronConfig,
): Promise<void> => {
  const today = getTodayISO();
  const schedules = await queryTodaySchedules(today);

  if (schedules.length > 0) {
    const text = buildScheduleText(schedules, today);
    await postToChannel(app.client, config.channelId, text);
    console.log('[Life Cron] 아침 일정 알림 전송');
  }
};

/** 기록 생성 + 어제 리뷰(LLM) + 아침 루틴 체크리스트 */
const morningTask = async (
  app: App,
  config: LifeCronConfig,
): Promise<void> => {
  const today = getTodayISO();
  const yesterday = getYesterdayISO();

  // 1. 오늘 기록 생성
  const created = await createTodayRecords(today);

  // 2. 어제 통계 → LLM 인사
  const yesterdayRecords = await queryTodayRecords(yesterday);
  const stats = calcRoutineStats(yesterdayRecords);

  const slotText = Object.entries(stats.slotBreakdown)
    .map(([s, d]) => `${s} ${d.rate}%`)
    .join(', ');

  const context = yesterdayRecords.length > 0
    ? `아침 인사 생성해줘.\n어제 루틴 달성률: ${stats.rate}% (${stats.completed}/${stats.total})\n시간대별: ${slotText}${stats.weakestSlot ? `\n가장 약한 시간대: ${stats.weakestSlot}` : ''}`
    : '아침 인사 생성해줘. 어제 루틴 기록이 없어.';

  const greeting = await generateCronMessage(
    config.llmClient, context,
    stats.rate > 0 ? `어제 루틴 ${stats.rate}%. 오늘도 힘내자!` : '좋은 아침! 오늘도 같이 힘내보자.',
  );
  const greetingBlocks = buildMorningGreetingBlocks(greeting);

  // 3. 아침 루틴 체크리스트
  const todayRecords = await queryTodayRecords(today);
  const hasMorning = todayRecords.some((r) => r.time_slot === '아침');

  if (hasMorning) {
    const { text, blocks } = buildFilteredRoutineBlocks(todayRecords, today, ['아침']);
    const fullBlocks = [...greetingBlocks, ...blocks];
    await postBlockMessage(app.client, config.channelId, text, fullBlocks);
  } else if (greetingBlocks.length > 0) {
    await postBlockMessage(app.client, config.channelId, '아침 인사', greetingBlocks);
  }

  console.log(`[Life Cron] 아침 알림 완료 (기록 ${created}개 생성)`);
};

/** 점심: 미완료 아침 + 점심 체크리스트 */
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
    console.log(`[Life Cron] 점심 알림 전송 완료`);
  }
};

/** 저녁: 미완료 아침/점심 + 저녁 체크리스트 */
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
    console.log(`[Life Cron] 저녁 알림 전송 완료`);
  }
};

/** 밤: 전체 루틴 요약 + LLM 마무리 */
const nightTask = async (
  app: App,
  config: LifeCronConfig,
): Promise<void> => {
  const today = getTodayISO();
  const records = await queryTodayRecords(today);

  if (records.length === 0) return;

  const stats = calcRoutineStats(records);
  const slotText = Object.entries(stats.slotBreakdown)
    .map(([s, d]) => `${s} ${d.rate}%`)
    .join(', ');

  const context = `밤 마무리 메시지 생성해줘.\n오늘 루틴 달성률: ${stats.rate}% (${stats.completed}/${stats.total})\n시간대별: ${slotText}`;

  const summary = await generateCronMessage(
    config.llmClient, context,
    stats.completed === stats.total
      ? '오늘 루틴 다 했어! 수고했어, 푹 쉬어.'
      : `오늘 루틴 ${stats.completed}/${stats.total} 완료. 수고했어!`,
  );

  const { text, blocks } = buildNightSummaryBlocks(records, today, summary);
  await postBlockMessage(app.client, config.channelId, text, blocks);
  console.log(`[Life Cron] 밤 요약 전송 완료`);
};

/** 밤 리뷰: 미완료 일정 + 수면 기록 확인 */
const nightReviewTask = async (
  app: App,
  config: LifeCronConfig,
): Promise<void> => {
  const today = getTodayISO();
  const yesterday = getYesterdayISO();

  // 1. 미완료 일정 텍스트
  const schedules = await queryTodaySchedules(today);
  const nightScheduleText = buildNightScheduleText(schedules, today);
  if (nightScheduleText) {
    await postToChannel(app.client, config.channelId, nightScheduleText);
  }

  // 2. 수면 기록 확인 (마지막에 — 묻히지 않게)
  const hasRecord = await queryNightSleepExists(yesterday, today);
  const sleepText = hasRecord ? buildSleepRecordedText('night') : buildSleepReminderText('night');
  await postToChannel(app.client, config.channelId, sleepText);

  console.log(`[Life Cron] 밤 리뷰 전송 완료 (수면기록: ${hasRecord ? '있음' : '없음'})`);
};

// ─── 유틸리티 ──────────────────────────────────────────

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

/** 'HH:MM' → 'MM HH * * *' 크론 표현식 변환 */
export const timeToCron = (timeValue: string): string => {
  const parts = timeValue.split(':');
  return `${Number(parts[1])} ${Number(parts[0])} * * *`;
};

// ─── slot_name → 태스크 매핑 ────────────────────────────

type CronTaskFn = (app: App, config: LifeCronConfig) => Promise<void>;

const SLOT_TASKS: Record<string, CronTaskFn> = {
  sleepCheck: sleepCheckTask,
  morningSchedule: morningScheduleTask,
  morning: morningTask,
  lunch: lunchTask,
  evening: eveningTask,
  night: nightTask,
  nightReview: nightReviewTask,
};

// ─── CronScheduler 클래스 ───────────────────────────────

interface CronTask {
  stop: () => void;
}

export class CronScheduler {
  private tasks = new Map<string, CronTask>();

  constructor(
    private readonly app: App,
    private readonly config: LifeCronConfig,
  ) {}

  /** DB에서 스케줄 로드 → 크론 등록 + 리마인더 체커 시작 */
  async init(): Promise<void> {
    await this.loadAndSchedule();
    this.startReminderChecker();
  }

  /** 기존 태스크 전체 파기 → DB 재로드 → 새 스케줄로 등록 */
  async reload(): Promise<void> {
    this.destroyAll();
    await this.loadAndSchedule();
    this.startReminderChecker();
    console.log('[Life Cron] 스케줄 리로드 완료');
  }

  /** 모든 태스크 정지 + 제거 */
  destroy(): void {
    this.destroyAll();
  }

  // ── 내부 메서드 ──

  private async loadAndSchedule(): Promise<void> {
    const settings = await queryNotificationSettings();
    const timezone = 'Asia/Seoul';
    const registered: string[] = [];

    for (const setting of settings) {
      if (!setting.active) continue;

      const taskFn = SLOT_TASKS[setting.slot_name];
      if (!taskFn) continue;

      const cronExpr = timeToCron(setting.time_value);
      const task = cron.schedule(
        cronExpr,
        wrapTask(taskFn, this.app, this.config, setting.label),
        { timezone },
      );
      this.tasks.set(setting.slot_name, task);
      registered.push(`${setting.label}(${setting.time_value})`);
    }

    console.log(`[Life Cron] 알림 스케줄 등록: ${registered.join(', ')}`);
  }

  private startReminderChecker(): void {
    const task = cron.schedule('* * * * *', async () => {
      try {
        await this.checkDueReminders();
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[Life Cron] 리마인더 체크 오류:', msg);
      }
    }, { timezone: 'Asia/Seoul' });

    this.tasks.set('_reminderChecker', task);
  }

  private async checkDueReminders(): Promise<void> {
    const today = getTodayISO();
    const currentTime = getKSTTimeString();
    const dow = getKSTDayOfWeek();

    const reminders = await queryDueReminders(today, currentTime, dow);

    for (const reminder of reminders) {
      await postToChannel(
        this.app.client,
        this.config.channelId,
        `리마인더: ${reminder.title}`,
      );

      // 일회성(date 지정) → 자동 비활성화
      if (reminder.date) {
        await deactivateReminder(reminder.id);
        console.log(`[Life Cron] 일회성 리마인더 비활성화: ${reminder.title}`);
      }
    }

    if (reminders.length > 0) {
      console.log(`[Life Cron] 리마인더 ${reminders.length}건 전송 (${currentTime})`);
    }
  }

  private destroyAll(): void {
    for (const task of this.tasks.values()) {
      task.stop();
    }
    this.tasks.clear();
  }
}
