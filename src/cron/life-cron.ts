/**
 * v4 크론 오케스트레이터.
 * DB(notification_settings)에서 스케줄 로드 → 동적 크론 등록.
 * 리마인더 체커: 매분 실행, reminders 테이블 조회 → 채널 전송.
 */

import cron from 'node-cron';
import type { App } from '@slack/bolt';
import type { LLMClient, LLMMessage } from '../shared/llm.js';
import type { RoutineRecordRow } from '../shared/life-queries.js';
import { query } from '../shared/db.js';
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
  buildRoutineBlocks,
  buildScheduleText,
  buildNightScheduleText,
  buildSleepReminderText,
  buildSleepRecordedText,
} from '../agents/life/blocks.js';
// insights.ts 넛지는 제거 — Sonnet이 생활 맥락에서 직접 인사이트 도출
// 복원 시: import { pickMorningNudge, pickNightNudge } from '../shared/insights.js';
import { weeklyReportTask } from './weekly-report.js';
import { buildLifeContext } from '../shared/life-context.js';
import { publishHomeView, getCachedHomeUserId } from '../agents/life/home.js';

export interface LifeCronConfig {
  channelId: string;
  llmClient: LLMClient;
}

// ─── LLM 메시지 생성 ────────────────────────────────────

const CRON_BASE_PROMPT = `너는 '잔소리꾼'. 사용자의 루틴과 일정, 수면, 일기, 삶의 고민까지 종합적으로 파악하는 친구.
${CHARACTER_PROMPT}

응답 포맷: Slack mrkdwn 문법.
- 굵게: *텍스트* (별표 1개). **텍스트** 절대 금지.
- 기울임: _텍스트_
- 제목/헤더(# ## ###) 사용 금지.
- 내용에 맞게 자연스러운 길이로 써. 억지로 짧게 줄이거나 늘리지 마.`;

const MORNING_SYSTEM_PROMPT = `${CRON_BASE_PROMPT}

지금은 아침이야. 오늘 하루를 시작하는 인사를 해줘.

## 시제 가이드
- "어젯밤 수면 N시간" → 어제 밤 수면량. 이미 지난 사실.
- "어제 루틴 달성률" → 어제 결과. 이미 지난 사실.
- "오늘 일정 N건" → 오늘 할 일. 아직 시작 전.
- 밀린 일정/백로그 → 오늘 처리하자고 제안.

## 데이터 해석 규칙
- 제공된 데이터에 없는 내용은 추측하지 마. 데이터에 있는 것만 언급해.
- 삶의 테마나 고민이 있으면 맥락에 맞게 한마디.
- 운세 정보가 있으면 자연스럽게 하루 조언에 녹여.
- 일기 내용이 있으면 어제 하루를 돌아보며 연결.`;

const NIGHT_SYSTEM_PROMPT = `${CRON_BASE_PROMPT}

지금은 밤 22시야. 하루를 마무리하는 메시지를 만들어줘.

## 시제 가이드
- "오늘 루틴 달성률" → 오늘 하루 결과.
- "어젯밤 수면 N시간" → 어제 밤 수면. 오늘 취침과 혼동 금지.
- 지금은 밤 10시. "일찍 자라"는 지금 바로 해당되는 조언이야.
- "내일 일찍 자봐" 금지 → "오늘은 일찍 자봐"가 맞아.

## 데이터 해석 규칙
- 제공된 데이터에 없는 내용은 추측하지 마. 데이터에 있는 것만 언급해.
- 수고했다는 느낌. 못 끝낸 건 내일 하자고 가볍게.
- 일기 내용이 있으면 하루를 돌아보며 한마디.
- 삶의 테마나 고민이 있으면 맥락에 맞게 따뜻하게.
- 운세 정보가 있으면 하루를 되돌아보는 맥락에서 연결.`;

/** LLM으로 크론 메시지 생성 (실패 시 fallback) */
const generateCronMessage = async (
  llmClient: LLMClient,
  systemPrompt: string,
  context: string,
  fallback: string,
): Promise<string> => {
  try {
    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
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
    const slot = slots[r.time_slot] ?? (slots[r.time_slot] = { total: 0, completed: 0, rate: 0 });
    slot.total++;
    if (r.completed) slot.completed++;
  }
  for (const s of Object.values(slots)) {
    s.rate = s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0;
  }

  let weakestSlot: string | null = null;
  let minRate = 100;
  for (const [slot, stat] of Object.entries(slots)) {
    if (stat.rate < minRate) {
      minRate = stat.rate;
      weakestSlot = slot;
    }
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
    const shouldCreate =
      t.frequency === '매일'
        ? true
        : shouldCreateToday(t.frequency, await queryLastRecordDate(t.id), today);

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
const sleepCheckTask = async (app: App, config: LifeCronConfig): Promise<void> => {
  const today = getTodayISO();
  const hasRecord = await queryNightSleepExists(today);

  const text = hasRecord ? buildSleepRecordedText('morning') : buildSleepReminderText('morning');
  await postToChannel(app.client, config.channelId, text);
  console.warn(`[Life Cron] 수면 체크 알림 전송 (기록: ${hasRecord ? '있음' : '없음'})`);
};

/** 오늘 일정 텍스트 알림 */
const morningScheduleTask = async (app: App, config: LifeCronConfig): Promise<void> => {
  const today = getTodayISO();
  const schedules = await queryTodaySchedules(today);

  if (schedules.length > 0) {
    const text = buildScheduleText(schedules, today);
    await postToChannel(app.client, config.channelId, text);
    console.warn('[Life Cron] 아침 일정 알림 전송');
  }
};

/** 기록 생성 + 어제 리뷰(LLM) + 아침 루틴 체크리스트 */
const morningTask = async (app: App, config: LifeCronConfig): Promise<void> => {
  const today = getTodayISO();
  const yesterday = getYesterdayISO();

  // 1. 오늘 기록 생성
  const created = await createTodayRecords(today);

  // 2. 생활 맥락 + 어제 통계 → Sonnet 통합 인사
  const yesterdayRecords = await queryTodayRecords(yesterday);
  const stats = calcRoutineStats(yesterdayRecords);
  const lifeContext = await buildLifeContext('morning');

  const slotText = Object.entries(stats.slotBreakdown)
    .map(([s, d]) => `${s} ${d.rate}%`)
    .join(', ');

  const baseContext =
    yesterdayRecords.length > 0
      ? `어제 루틴 달성률: ${stats.rate}% (${stats.completed}/${stats.total})\n시간대별: ${slotText}${stats.weakestSlot ? `\n가장 약한 시간대: ${stats.weakestSlot}` : ''}`
      : '어제 루틴 기록이 없어.';

  const context = `아침 인사 생성해줘.\n${baseContext}${lifeContext}`;

  const greeting = await generateCronMessage(
    config.llmClient,
    MORNING_SYSTEM_PROMPT,
    context,
    stats.rate > 0
      ? `어제 루틴 ${stats.rate}%. 오늘도 힘내자!`
      : '좋은 아침! 오늘도 같이 힘내보자.',
  );
  const greetingBlocks = buildMorningGreetingBlocks(greeting);

  // 3. 아침 루틴 체크리스트
  const todayRecords = await queryTodayRecords(today);
  const hasMorning = todayRecords.some((r) => r.time_slot === '아침');

  // 체크리스트 먼저, 인사 메시지는 별도 전송 (체크리스트 업데이트 시 인사가 사라지는 문제 방지)
  if (hasMorning) {
    const { text, blocks } = buildFilteredRoutineBlocks(todayRecords, today, ['아침']);
    await postBlockMessage(app.client, config.channelId, text, blocks);
  }
  if (greetingBlocks.length > 0) {
    await postBlockMessage(app.client, config.channelId, '아침 인사', greetingBlocks);
  }

  // 4. 앱홈 갱신 (날짜 전환 반영)
  const userId = getCachedHomeUserId();
  if (userId) {
    try {
      await publishHomeView(app.client, userId);
      console.warn('[Life Cron] 앱홈 갱신 완료');
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[Life Cron] 앱홈 갱신 실패: ${msg}`);
    }
  }

  console.warn(`[Life Cron] 아침 알림 완료 (기록 ${created}개 생성)`);
};

/** 점심: 미완료 아침 + 점심 체크리스트 */
const lunchTask = async (app: App, config: LifeCronConfig): Promise<void> => {
  const today = getTodayISO();
  const records = await queryTodayRecords(today);

  const hasItems = records.some(
    (r) => r.time_slot === '점심' || (r.time_slot === '아침' && !r.completed),
  );

  if (hasItems) {
    const { text, blocks } = buildFilteredRoutineBlocks(records, today, ['점심'], ['아침']);
    await postBlockMessage(app.client, config.channelId, text, blocks);
    console.warn(`[Life Cron] 점심 알림 전송 완료`);
  }
};

/** 저녁: 미완료 아침/점심 + 저녁 체크리스트 */
const eveningTask = async (app: App, config: LifeCronConfig): Promise<void> => {
  const today = getTodayISO();
  const records = await queryTodayRecords(today);

  const hasItems = records.some(
    (r) =>
      r.time_slot === '저녁' ||
      ((r.time_slot === '아침' || r.time_slot === '점심') && !r.completed),
  );

  if (hasItems) {
    const { text, blocks } = buildFilteredRoutineBlocks(records, today, ['저녁'], ['아침', '점심']);
    await postBlockMessage(app.client, config.channelId, text, blocks);
    console.warn(`[Life Cron] 저녁 알림 전송 완료`);
  }
};

/** 밤: 전체 루틴 요약 + LLM 마무리 */
const nightTask = async (app: App, config: LifeCronConfig): Promise<void> => {
  const today = getTodayISO();
  const records = await queryTodayRecords(today);

  if (records.length === 0) return;

  // 루틴 통계 + 생활 맥락 → Sonnet 통합 마무리 메시지
  const stats = calcRoutineStats(records);
  const lifeContext = await buildLifeContext('night');
  const slotText = Object.entries(stats.slotBreakdown)
    .map(([s, d]) => `${s} ${d.rate}%`)
    .join(', ');

  const context = `밤 마무리 메시지 생성해줘.\n오늘 루틴 달성률: ${stats.rate}% (${stats.completed}/${stats.total})\n시간대별: ${slotText}${lifeContext}`;

  const summary = await generateCronMessage(
    config.llmClient,
    NIGHT_SYSTEM_PROMPT,
    context,
    stats.completed === stats.total
      ? '오늘 루틴 다 했어! 수고했어, 푹 쉬어.'
      : `오늘 루틴 ${stats.completed}/${stats.total} 완료. 수고했어!`,
  );

  // 체크리스트 먼저, 마무리 메시지는 별도 전송 (체크리스트 업데이트 시 메시지가 사라지는 문제 방지)
  const { text, blocks } = buildRoutineBlocks(records, today);
  await postBlockMessage(app.client, config.channelId, text, blocks);

  const summaryBlocks = buildMorningGreetingBlocks(summary);
  await postBlockMessage(app.client, config.channelId, '밤 마무리', summaryBlocks);
  console.warn(`[Life Cron] 밤 요약 전송 완료`);
};

/** 밤 리뷰: 미완료 일정 + 수면 기록 확인 */
const nightReviewTask = async (app: App, config: LifeCronConfig): Promise<void> => {
  const today = getTodayISO();

  // 1. 미완료 일정 텍스트
  const schedules = await queryTodaySchedules(today);
  const nightScheduleText = buildNightScheduleText(schedules, today);
  if (nightScheduleText) {
    await postToChannel(app.client, config.channelId, nightScheduleText);
  }

  // 2. 수면 기록 확인 (마지막에 — 묻히지 않게)
  const hasRecord = await queryNightSleepExists(today);
  const sleepText = hasRecord ? buildSleepRecordedText('night') : buildSleepReminderText('night');
  await postToChannel(app.client, config.channelId, sleepText);

  console.warn(`[Life Cron] 밤 리뷰 전송 완료 (수면기록: ${hasRecord ? '있음' : '없음'})`);
};

// ─── Insight 크론 태스크 ─────────────────────────────────

/** 아침 일운 분석 알림 → #insight 채널 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const insightMorningTask = async (app: App, _config: LifeCronConfig): Promise<void> => {
  const insightChannel = process.env['INSIGHT_CHANNEL_ID'] ?? '';
  if (!insightChannel) return;

  const today = getTodayISO();
  const result = await query(
    `SELECT analysis, summary FROM fortune_analyses WHERE user_id = 1 AND date = $1 AND period = 'daily' ORDER BY created_at DESC LIMIT 1`,
    [today],
  );

  if (result.rows.length > 0) {
    const fortune = result.rows[0] as { analysis: string; summary: string | null };
    const text = fortune.summary
      ? `${fortune.summary}\n\n${fortune.analysis}`
      : fortune.analysis;
    await postToChannel(app.client, insightChannel, text);
    console.warn('[Life Cron] 일운 분석 알림 전송 완료');
  } else {
    await postToChannel(
      app.client,
      insightChannel,
      '오늘의 일운 분석이 아직 준비되지 않았어. 곧 업데이트될 거야.',
    );
    console.warn('[Life Cron] 일운 분석 없음 — 대기 메시지 전송');
  }
};

/** 밤 일기 리마인더 → #insight 채널 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const insightNightTask = async (app: App, _config: LifeCronConfig): Promise<void> => {
  const insightChannel = process.env['INSIGHT_CHANNEL_ID'] ?? '';
  if (!insightChannel) return;

  const today = getTodayISO();
  const result = await query(
    `SELECT 1 FROM diary_entries WHERE user_id = 1 AND date = $1 LIMIT 1`,
    [today],
  );

  const hasDiary = result.rows.length > 0;
  const text = hasDiary
    ? '오늘 이미 일기를 남겼네. 혹시 더 추가하고 싶은 이야기가 있으면 편하게 남겨.'
    : '오늘 하루는 어땠어? 간단하게라도 일기를 남겨보자. 생각나는 대로 편하게 말해줘.';

  await postToChannel(app.client, insightChannel, text);
  console.warn(`[Life Cron] 일기 리마인더 전송 (기존 기록: ${hasDiary ? '있음' : '없음'})`);
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
          app.client,
          config.channelId,
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
  weeklyReport: weeklyReportTask,
  insightMorning: insightMorningTask,
  insightNight: insightNightTask,
};

// ─── CronScheduler 클래스 ───────────────────────────────

/** reload() debounce 대기 시간 (ms) */
export const RELOAD_DEBOUNCE_MS = 500;

interface CronTask {
  stop: () => void;
}

export class CronScheduler {
  private tasks = new Map<string, CronTask>();
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;
  private reloading = false;
  private reloadQueued = false;

  constructor(
    private readonly app: App,
    private readonly config: LifeCronConfig,
  ) {}

  /** DB에서 스케줄 로드 → 크론 등록 + 리마인더 체커 시작 */
  async init(): Promise<void> {
    await this.loadAndSchedule();
    this.startReminderChecker();
  }

  /**
   * 기존 태스크 전체 파기 → DB 재로드 → 새 스케줄로 등록.
   * debounce 적용: 연속 호출 시 마지막 호출만 실행.
   * mutex 적용: 실행 중 재호출 시 큐잉 후 완료 후 1회 재실행.
   */
  reload(): void {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
    }
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null;
      void this.executeReload();
    }, RELOAD_DEBOUNCE_MS);
  }

  /** 모든 태스크 정지 + 제거 (pending debounce 포함) */
  destroy(): void {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = null;
    }
    this.destroyAll();
  }

  // ── 내부 메서드 ──

  private async executeReload(): Promise<void> {
    if (this.reloading) {
      this.reloadQueued = true;
      return;
    }

    this.reloading = true;
    try {
      this.destroyAll();
      await this.loadAndSchedule();
      this.startReminderChecker();
      console.warn('[Life Cron] 스케줄 리로드 완료');
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[Life Cron] 리로드 실패:', msg);
    } finally {
      this.reloading = false;
      if (this.reloadQueued) {
        this.reloadQueued = false;
        await this.executeReload();
      }
    }
  }

  private async loadAndSchedule(): Promise<void> {
    const settings = await queryNotificationSettings();
    const timezone = 'Asia/Seoul';
    const registered: string[] = [];

    for (const setting of settings) {
      if (!setting.active) continue;

      const taskFn = SLOT_TASKS[setting.slot_name];
      if (!taskFn) continue;

      const cronExpr = timeToCron(setting.time_value);
      const task = cron.schedule(cronExpr, wrapTask(taskFn, this.app, this.config, setting.label), {
        timezone,
      });

      // 안전장치: 기존 task가 있으면 먼저 정지 (좀비 방지)
      const existing = this.tasks.get(setting.slot_name);
      if (existing) existing.stop();

      this.tasks.set(setting.slot_name, task);
      registered.push(`${setting.label}(${setting.time_value})`);
    }

    console.warn(`[Life Cron] 알림 스케줄 등록: ${registered.join(', ')}`);
  }

  private startReminderChecker(): void {
    const task = cron.schedule(
      '* * * * *',
      async () => {
        try {
          await this.checkDueReminders();
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error('[Life Cron] 리마인더 체크 오류:', msg);
        }
      },
      { timezone: 'Asia/Seoul' },
    );

    // 안전장치: 기존 리마인더 체커가 있으면 먼저 정지
    const existing = this.tasks.get('_reminderChecker');
    if (existing) existing.stop();

    this.tasks.set('_reminderChecker', task);
  }

  private async checkDueReminders(): Promise<void> {
    const today = getTodayISO();
    const currentTime = getKSTTimeString();
    const dow = getKSTDayOfWeek();

    const reminders = await queryDueReminders(today, currentTime, dow);

    for (const reminder of reminders) {
      await postToChannel(this.app.client, this.config.channelId, `리마인더: ${reminder.title}`);

      // 일회성(date 지정) → 자동 비활성화
      if (reminder.date) {
        await deactivateReminder(reminder.id);
        console.warn(`[Life Cron] 일회성 리마인더 비활성화: ${reminder.title}`);
      }
    }

    if (reminders.length > 0) {
      console.warn(`[Life Cron] 리마인더 ${reminders.length}건 전송 (${currentTime})`);
    }
  }

  private destroyAll(): void {
    for (const task of this.tasks.values()) {
      task.stop();
    }
    this.tasks.clear();
  }
}
