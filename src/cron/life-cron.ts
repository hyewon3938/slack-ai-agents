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
  queryNotificationSettings,
  queryActiveReminderTimes,
  queryDueReminders,
  deactivateReminder,
  decrementReminderCount,
} from '../shared/life-queries.js';
import { postToChannel } from '../shared/slack.js';
import {
  getTodayISO,
  getYesterdayISO,
  getEffectiveTodayISO,
  getKSTTimeString,
  getKSTDayOfWeek,
  addDays,
} from '../shared/kst.js';
import {
  DEFAULT_USER_ID,
  queryAllUserMappings,
  type UserMapping,
} from '../shared/user-resolver.js';
// personality.ts의 CHARACTER_PROMPT는 에이전트용, 크론은 자체 톤 사용
import {
  buildScheduleText,
  buildNightScheduleText,
  buildYesterdayIncompleteText,
} from '../agents/life/blocks.js';
import { pickMorningNudges, pickNightNudges } from '../shared/insights.js';
import { weeklyReportTask } from './weekly-report.js';
import { dailyPatternMatchingTask } from './daily-pattern-matching.js';
import { diaryMetaExtractTask } from './diary-meta-extract.js';
import { weeklyVerificationTask, weeklyReviewFallbackTask } from './weekly-verification.js';
import { signalSuggestFallbackTask } from './signal-suggest-fallback.js';
import { discoveryRecommendTask } from './discovery-recommend.js';
import { periodFortuneTask } from './period-fortune.js';
import { buildLifeContext } from '../shared/life-context.js';
import { publishHomeView } from '../agents/life/home.js';

export interface LifeCronConfig {
  channelId: string;
  llmClient: LLMClient;
}

// ─── 멀티유저 루프 헬퍼 ─────────────────────────────────

/**
 * 크론 전송 채널 결정:
 * 1) 매핑의 전용 채널(life/insight) → 사용
 * 2) NULL이면 slackUserId 반환 → Slack이 자동으로 해당 유저와의 DM으로 전송
 */
const resolveCronChannel = (mapping: UserMapping, type: 'life' | 'insight'): string => {
  const channel = type === 'life' ? mapping.lifeChannelId : mapping.insightChannelId;
  return channel ?? mapping.slackUserId;
};

/**
 * 크론 태스크 공통 유저 루프 헬퍼.
 * - 매핑이 비어있으면 DEFAULT_USER_ID + config.channelId로 1회 실행 (하위 호환)
 * - 매핑 존재 시 각 유저별로 handler 호출, 유저별 에러는 격리
 */
const forEachUser = async (
  config: LifeCronConfig,
  type: 'life' | 'insight',
  label: string,
  handler: (userId: number, channelId: string) => Promise<void>,
): Promise<void> => {
  const mappings = await queryAllUserMappings();

  if (mappings.length === 0) {
    const fallbackChannel =
      type === 'life' ? config.channelId : (process.env['INSIGHT_CHANNEL_ID'] ?? '');
    if (!fallbackChannel) return;
    try {
      await handler(DEFAULT_USER_ID, fallbackChannel);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[Life Cron] ${label} 폴백 실행 실패: ${msg}`);
    }
    return;
  }

  for (const mapping of mappings) {
    const channelId = resolveCronChannel(mapping, type);
    if (!channelId) continue;
    try {
      await handler(mapping.userId, channelId);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[Life Cron] ${label} 유저 ${mapping.userId} 처리 실패: ${msg}`);
    }
  }
};

// ─── LLM 메시지 생성 ────────────────────────────────────

const CRON_BASE_PROMPT = `너는 사용자의 루틴, 일정, 수면, 일기, 삶의 고민까지 종합적으로 파악하는 친구.
따뜻하게 챙겨주는 스타일. 잔소리보다는 진심 어린 관심.
- 응원할 때는 진심으로. 예: "오늘도 잘 해보자." / "어제 고생했어."
- 걱정할 때는 부드럽게. 예: "좀 무리한 것 같은데, 오늘은 쉬엄쉬엄 하자."
- 칭찬은 솔직하게. 예: "어제 잘했어." / "꾸준히 하고 있네."
허용 어미: ~자, ~겠어, ~봐, ~써, ~해, ~어.
금지 어미(절대 사용 금지): ~거라, ~냐, ~니, ~다며, ~냐고, ~렴, ~라고.
이모지/존댓말 금지.

응답 포맷: Slack mrkdwn 문법.
- 굵게: *텍스트* (별표 1개). **텍스트** 절대 금지.
- 기울임: _텍스트_
- 제목/헤더(# ## ###) 사용 금지.
- 내용에 맞게 자연스러운 길이로 써. 억지로 짧게 줄이거나 늘리지 마.`;

const NIGHT_SYSTEM_PROMPT = `${CRON_BASE_PROMPT}

지금은 밤 22시야. 하루를 마무리하는 메시지를 만들어줘.

## 시제 가이드
- "오늘 루틴 현황" → 23:55 기준 중간 현황이야. 자정 넘어서 마무리할 수 있으니 최종 결과가 아님. "아직 진행 중일 수 있으니" 톤으로.
- "어젯밤 수면 N시간" → 어제 밤 수면. 오늘 취침과 혼동 금지.
- 지금은 밤 10시. "일찍 자라"는 지금 바로 해당되는 조언이야.
- "내일 일찍 자봐" 금지 → "오늘은 일찍 자봐"가 맞아.

## 수면 데이터 해석 (중요)
- "어젯밤 N시간 (취침~기상)" → 취침 시간에 잠들어서 기상 시간에 일어난 것. 수면 시간과 기상 시간은 하나의 사실이야.
- "짧게 잤으면서 왜 일찍 일어났어?" 같은 모순된 표현 금지. 수면이 짧으면 "늦게 잤네" 또는 "좀 더 잤으면 좋았을 텐데" 식으로.
- 수면 시간과 기상 시간을 따로따로 지적하지 마. 하나로 묶어서 자연스럽게 언급해.

## 데이터 해석 규칙
- 제공된 데이터에 없는 내용은 추측하지 마. 데이터에 있는 것만 언급해.
- 수고했다는 느낌. 아직 안 한 루틴은 "아직 할 수 있으니까" 톤으로 가볍게. 최종 정산은 내일 아침에 할 거야.
- 일기 내용이 있으면 하루를 돌아보며 한마디.
- 삶의 테마나 고민이 있으면 맥락에 맞게 따뜻하게.
- 운세 정보가 있으면 하루를 되돌아보는 맥락에서 연결.`;

const INSIGHT_NIGHT_SYSTEM_PROMPT = `${CRON_BASE_PROMPT}

지금은 밤이야. 사용자의 오늘 일기를 읽고 하루를 돌아보는 코멘트를 해줘.
- 일기 내용에 공감하면서 따뜻하게 마무리.
- 오늘 일운 데이터가 있으면 사주적 관점에서 자연스럽게 연결.
- 길게 쓰지 마. 2~3문장이면 충분해.
- "오늘 일기를 보니" 같은 메타 표현 금지. 자연스럽게.

## ⛔ 십성 정확도
- 일운 데이터에 십성(편관/정관 등)이 기재되어 있으면 그 표현을 그대로 인용해.
- 직접 십성을 계산/추론하지 마. 확신 없으면 천간/지지 이름만 써.
- 어제와 오늘의 십성을 섞지 마 — 날짜별로 일주가 다르므로 십성도 달라져.`;

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

/**
 * 루틴 달성률 집계. 입력이 이미 주기형만으로 걸러져 있다고 전제한다
 * (queryTodayRecords가 entry_type='scheduled'로 격리) — 자율 기록은 분모가 아니다 (ADR-0061).
 */
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
export const createTodayRecords = async (
  today: string,
  userId: number = DEFAULT_USER_ID,
): Promise<number> => {
  const templates = await queryActiveTemplates(userId);
  const existingIds = await queryExistingTemplateIds(today, userId);

  // 자율 루틴은 기대된 발생이 없다 → 미리 만들지 않는다 (ADR-0061)
  const candidates = templates.filter(
    (t) => t.tracking_mode === 'scheduled' && !existingIds.has(t.id),
  );

  let created = 0;
  for (const t of candidates) {
    const shouldCreate =
      t.frequency === '매일'
        ? !t.start_date || today >= t.start_date
        : shouldCreateToday(
            t.frequency,
            await queryLastRecordDate(t.id, userId),
            today,
            t.start_date,
          );

    if (shouldCreate) {
      try {
        await createRecord(t.id, today, userId);
        created++;
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[Life Cron] 기록 생성 실패 (${t.name}): ${msg}`);
      }
    }
  }

  return created;
};

// ─── 일별 예산 로그 자동 백필 (Vercel cron 누락 방어) ──

/**
 * 예정지출별 누적 사용량이 예산을 초과한 부분의 합 (upToDate까지).
 * Σ max(0, used(p) - p.amount). 웹 readPlannedOverflow(ADR-0007 SSOT)의 복제본.
 */
const queryPlannedOverflow = async (
  userId: number,
  billingMonth: string,
  upToDate: string,
): Promise<number> => {
  const result = await query<{ overflow: string }>(
    `SELECT COALESCE(SUM(GREATEST(used - budget, 0)), 0)::text AS overflow
     FROM (
       SELECT p.amount AS budget, COALESCE(SUM(e.amount), 0) AS used
       FROM planned_expenses p
       LEFT JOIN expenses e
         ON e.planned_expense_id = p.id
         AND e.user_id = p.user_id
         AND e.billing_month = $2
         AND e.date <= $3
       WHERE p.user_id = $1
       GROUP BY p.id, p.amount
     ) sub`,
    [userId, billingMonth, upToDate],
  );
  return Number(result.rows[0]?.overflow ?? 0);
};

/**
 * 어제자 자유 지출 = directFlex(어제) + max(0, overflow(어제까지) - overflow(그제까지)).
 * 웹 readTodayFlexSpent(ADR-0007 SSOT)의 복제본 — 할부 전액 제외, 예정지출 초과분만 일별 증가분으로 가산.
 * 웹 정의 변경 시 이 함수 + queryPlannedOverflow + 테스트를 동기화할 것.
 */
export const calcYesterdayFlexSpent = async (
  userId: number,
  yesterday: string,
  billingMonth: string,
): Promise<number> => {
  const dayBefore = addDays(yesterday, -1);
  const [directResult, yesterdayOverflow, dayBeforeOverflow] = await Promise.all([
    query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS total
       FROM expenses
       WHERE user_id = $1
         AND COALESCE(type, 'expense') = 'expense'
         AND exclude_from_budget = false
         AND planned_expense_id IS NULL
         AND date = $2::date
         AND is_installment = false`,
      [userId, yesterday],
    ),
    queryPlannedOverflow(userId, billingMonth, yesterday),
    queryPlannedOverflow(userId, billingMonth, dayBefore),
  ]);
  const direct = Number(directResult.rows[0]?.total ?? 0);
  const dailyOverflow = Math.max(0, yesterdayOverflow - dayBeforeOverflow);
  return direct + dailyOverflow;
};

/** 결제주기 시작일 — 웹 billing/cycle-config.ts CYCLE_START_DAY와 같은 값을 유지해야 한다. */
export const CYCLE_START_DAY = 16;

/** 결제주기 마지막 날 = 시작일 하루 전 */
const CYCLE_END_DAY = CYCLE_START_DAY - 1;

/**
 * 결제일 사이클(전월 16일 ~ 당월 15일)을 적용해 해당 날짜의 billing_month 'YYYY-MM' 반환.
 * 웹 billing/cycle.ts getCurrentBillingMonth와 동일 규칙 — 변경 시 양쪽 동기화.
 */
export const getBillingMonthForDate = (isoDate: string): string => {
  const [yStr, mStr, dStr] = isoDate.split('-');
  let year = Number(yStr);
  let month = Number(mStr);
  const day = Number(dStr);
  if (day >= CYCLE_START_DAY) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return `${year}-${String(month).padStart(2, '0')}`;
};

// ─── 목표 기간 만료 임박 알림 (#554) ────────────────────

/** 만료 임박 경고를 시작하는 남은 일수 (6주). */
export const TARGET_EXPIRY_WARN_DAYS = 42;

/** 두 날짜(YYYY-MM-DD) 사이의 일수 (to − from). */
const diffDaysISO = (from: string, to: string): number => {
  const msPerDay = 86_400_000;
  const fromMs = new Date(`${from}T00:00:00+09:00`).getTime();
  const toMs = new Date(`${to}T00:00:00+09:00`).getTime();
  return Math.round((toMs - fromMs) / msPerDay);
};

/**
 * 목표 기간(target_date 'YYYY-MM')의 만료일 = 그 달 결제 주기의 마지막 날.
 * getBillingMonthForDate와 같은 주기 규칙(전월 16일 ~ 당월 15일) → 만료일 = target_date 그 달 15일.
 * (예: target '2026-08' → 만료일 '2026-08-15')
 */
export const getTargetExpiryDate = (targetDate: string): string =>
  `${targetDate}-${String(CYCLE_END_DAY).padStart(2, '0')}`;

/**
 * 목표 기간 만료 임박/경과 안내 문구 생성 (순수 함수).
 * - target_date 없음 → null (안내 없음)
 * - 남은 일수 > 42(6주) → null (아직 여유)
 * - 0 < 남은 일수 ≤ 42 → 임박 안내
 * - 남은 일수 ≤ 0 (만료일 당일 포함 이후) → 정지 안내
 * 금액·재정 상황 언급 없이 기간·일수만 사용.
 */
export const buildTargetExpiryWarning = (
  targetDate: string | null,
  today: string,
): string | null => {
  if (!targetDate) return null;

  const expiry = getTargetExpiryDate(targetDate);
  const remaining = diffDaysISO(today, expiry);

  if (remaining > TARGET_EXPIRY_WARN_DAYS) return null;

  if (remaining > 0) {
    return `예산 목표 기간(${targetDate})이 ${remaining}일 뒤에 끝나. 끝나면 예산 계산이 멈추니까 대시보드 설정에서 연장해두자.`;
  }

  return '예산 목표 기간이 지났어. 연장 전까지 예산 계산이 멈춰 있어 — 설정에서 target 늘려줘.';
};

/**
 * 월요일에만 목표 기간 만료 임박/경과를 채널로 안내 (주 1회 중복 방지, 별도 상태 저장 불필요).
 * 채널: 매핑에 money 전용 채널이 없으므로 life 채널(없으면 DM)로 폴백.
 * 아침 알림 본체에 영향 없도록 morningTask에서 try/catch로 격리 호출.
 */
export const warnTargetExpiryIfNear = async (app: App, config: LifeCronConfig): Promise<void> => {
  // 월요일(1)에만 실행 → 주 1회.
  if (getKSTDayOfWeek() !== 1) return;

  const today = getTodayISO();

  await forEachUser(config, 'life', '목표 기간 만료 알림', async (userId, channelId) => {
    const result = await query<{ target_date: string | null }>(
      'SELECT target_date FROM budget_settings WHERE user_id = $1',
      [userId],
    );
    const targetDate = result.rows[0]?.target_date ?? null;

    const message = buildTargetExpiryWarning(targetDate, today);
    if (!message) return;

    await postToChannel(app.client, channelId, message);
    console.warn(`[Life Cron] 목표 기간 만료 알림 전송 (유저=${userId})`);
  });
};

/**
 * 어제자 daily_budget_logs 누락 감지 → 직접 INSERT 백필.
 * - budget: 같은 billing_month의 직전 로그에서 복제 (allocation 로직 미복제 — 웹 없이는 재현 불가)
 * - spent: 웹 readTodayFlexSpent(ADR-0007 SSOT)의 복제본 = directFlex(비할부) + 일별 plannedOverflow 증가분.
 *   웹 정의 변경 시 이 함수 + 테스트를 동기화할 것.
 * - 백필 발생 시 #project 채널로 Slack 알림
 */
const backfillYesterdayBudgetLogIfMissing = async (app: App): Promise<void> => {
  const yesterday = getYesterdayISO();
  const billingMonth = getBillingMonthForDate(yesterday);

  const usersResult = await query<{ id: number }>('SELECT id FROM users ORDER BY id');
  const backfilled: Array<{ userId: number; budget: number; spent: number; saved: number }> = [];
  const failures: Array<{ userId: number; reason: string }> = [];

  for (const { id: userId } of usersResult.rows) {
    try {
      const existing = await query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM daily_budget_logs WHERE user_id = $1 AND date = $2',
        [userId, yesterday],
      );
      if (Number(existing.rows[0]?.count ?? 0) > 0) continue;

      const prevBudgetRow = await query<{ budget: number }>(
        `SELECT budget FROM daily_budget_logs
         WHERE user_id = $1 AND billing_month = $2 AND date < $3
         ORDER BY date DESC LIMIT 1`,
        [userId, billingMonth, yesterday],
      );
      const prevBudget = prevBudgetRow.rows[0];
      if (!prevBudget) {
        failures.push({ userId, reason: '같은 billing_month에 이전 로그 없음' });
        continue;
      }
      const budget = prevBudget.budget;

      const spent = await calcYesterdayFlexSpent(userId, yesterday, billingMonth);
      const saved = budget - spent;

      await query(
        `INSERT INTO daily_budget_logs (user_id, date, billing_month, budget, spent, saved)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, date) DO NOTHING`,
        [userId, yesterday, billingMonth, budget, spent, saved],
      );
      backfilled.push({ userId, budget, spent, saved });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      failures.push({ userId, reason: msg });
      console.error(`[Life Cron] 백필 실패 (user=${userId}):`, msg);
    }
  }

  if (backfilled.length === 0 && failures.length === 0) return;

  const projectChannel = process.env['PROJECT_CHANNEL_ID'] ?? '';
  if (!projectChannel) {
    console.warn('[Life Cron] PROJECT_CHANNEL_ID 미설정 — 백필 알림 생략');
    return;
  }

  const lines: string[] = [];
  if (backfilled.length > 0) {
    lines.push('*백필 완료*');
    for (const b of backfilled) {
      lines.push(`• user_id=${b.userId}: budget=${b.budget}, spent=${b.spent}, saved=${b.saved}`);
    }
  }
  if (failures.length > 0) {
    lines.push('*백필 실패*');
    for (const f of failures) {
      lines.push(`• user_id=${f.userId}: ${f.reason}`);
    }
  }
  const text = `Vercel cron 누락 감지 — 어제자(${yesterday}) 일별 예산 로그 자동 백필\n${lines.join('\n')}`;

  try {
    await postToChannel(app.client, projectChannel, text);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Life Cron] 백필 알림 전송 실패:', msg);
  }

  console.warn(
    `[Life Cron] 일별 예산 로그 백필: 성공 ${backfilled.length}명, 실패 ${failures.length}명`,
  );
};

// ─── 크론 태스크 ────────────────────────────────────────

/** 아침: 어제 루틴 최종 달성률 + 루틴 기록 생성 + 오늘 일정 (LLM 없음) */
const morningTask = async (app: App, config: LifeCronConfig): Promise<void> => {
  const today = getTodayISO();
  const yesterday = getYesterdayISO();

  // Vercel cron 누락 방어: 어제자 일별 예산 로그 자동 백필
  try {
    await backfillYesterdayBudgetLogIfMissing(app);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Life Cron] 일별 예산 로그 백필 체크 실패:', msg);
  }

  // 목표 기간 만료 임박 알림 (월요일만, 주 1회) — 실패해도 아침 알림 본체에 영향 없게 격리
  try {
    await warnTargetExpiryIfNear(app, config);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Life Cron] 목표 기간 만료 알림 체크 실패:', msg);
  }

  await forEachUser(config, 'life', '아침 알림', async (userId, channelId) => {
    // 1. 어제 루틴 최종 달성률
    const yesterdayRecords = await queryTodayRecords(yesterday, userId);
    if (yesterdayRecords.length > 0) {
      const stats = calcRoutineStats(yesterdayRecords);
      const slotText = Object.entries(stats.slotBreakdown)
        .map(([s, d]) => `${s} ${d.completed}/${d.total}`)
        .join(', ');
      const line =
        stats.completed === stats.total
          ? `어제 루틴 전부 완료! ${stats.rate}% (${stats.completed}/${stats.total}) — ${slotText}`
          : `어제 루틴 최종 ${stats.rate}% (${stats.completed}/${stats.total}) — ${slotText}`;
      await postToChannel(app.client, channelId, line);
    }

    // 1-2. 어제 못 끝낸 일정 요약 (end_date가 오늘 이후인 진행 중 기간 일정은 제외)
    const yesterdaySchedules = await queryTodaySchedules(yesterday, userId);
    const yesterdayIncompleteText = buildYesterdayIncompleteText(
      yesterdaySchedules,
      yesterday,
      today,
    );
    if (yesterdayIncompleteText) {
      await postToChannel(app.client, channelId, yesterdayIncompleteText);
    }

    // 1-3. 프로액티브 인사이트 (priority ≥5인 패턴 0~3개)
    // 월요일은 09:00 주간 리포트가 별도 발송 → 중복 방지
    if (getKSTDayOfWeek() !== 1) {
      const insights = await pickMorningNudges(today, userId);
      if (insights.length > 0) {
        const text = insights.map((i) => i.message).join('\n');
        await postToChannel(app.client, channelId, text);
      }
    }

    // 2. 오늘 루틴 기록 생성
    const created = await createTodayRecords(today, userId);

    // 3. 오늘 일정 텍스트
    const schedules = await queryTodaySchedules(today, userId);
    if (schedules.length > 0) {
      const scheduleText = buildScheduleText(schedules, today);
      await postToChannel(app.client, channelId, scheduleText);
    }

    console.warn(`[Life Cron] 아침 알림 완료 (유저=${userId}, 기록 ${created}개 생성)`);
  });

  // 앱홈 갱신 — 모든 등록 유저의 Slack user ID 순회
  const mappings = await queryAllUserMappings();
  for (const mapping of mappings) {
    try {
      await publishHomeView(app.client, mapping.slackUserId);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[Life Cron] 앱홈 갱신 실패 (${mapping.slackUserId}): ${msg}`);
    }
  }
};

/** 밤: 일정 리뷰 + 루틴 달성률 요약 + LLM 마무리 */
const nightTask = async (app: App, config: LifeCronConfig): Promise<void> => {
  const today = getTodayISO();

  await forEachUser(config, 'life', '밤 요약', async (userId, channelId) => {
    const records = await queryTodayRecords(today, userId);
    if (records.length === 0) return;

    const stats = calcRoutineStats(records);
    const lifeContext = await buildLifeContext('night', userId);
    const slotText = Object.entries(stats.slotBreakdown)
      .map(([s, d]) => `${s} ${d.rate}%`)
      .join(', ');

    // 미완료 일정 컨텍스트 (nightReview 통합)
    const schedules = await queryTodaySchedules(today, userId);
    const nightScheduleText = buildNightScheduleText(schedules, today);
    const scheduleContext = nightScheduleText ? `\n일정 현황: ${nightScheduleText}` : '';

    const context = `밤 마무리 메시지 생성해줘.\n오늘 루틴 현황 (23:55 기준, 자정 넘어서 마무리할 수 있음): ${stats.rate}% (${stats.completed}/${stats.total})\n시간대별: ${slotText}${scheduleContext}${lifeContext}`;

    const fallback =
      stats.completed === stats.total
        ? '오늘 루틴 다 했어! 수고했어, 푹 쉬어.'
        : `오늘 루틴 현재까지 ${stats.completed}/${stats.total} 완료. 아직 할 수 있으니까 천천히!`;

    const summary = await generateCronMessage(
      config.llmClient,
      NIGHT_SYSTEM_PROMPT,
      context,
      fallback,
    );

    try {
      const summaryText = summary || fallback;
      await postToChannel(app.client, channelId, summaryText);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[Life Cron] 밤 마무리 메시지 전송 실패 (유저=${userId}): ${msg}`);
    }

    // 프로액티브 인사이트 (priority ≥5인 패턴 0~3개)
    const insights = await pickNightNudges(today, userId);
    if (insights.length > 0) {
      const text = insights.map((i) => i.message).join('\n');
      await postToChannel(app.client, channelId, text);
    }

    console.warn(`[Life Cron] 밤 요약 전송 완료 (유저=${userId})`);
  });
};

// ─── Insight 크론 태스크 ─────────────────────────────────
// (아침 일운 알림 insightMorningTask는 daily-insight routine으로 이관 — ADR-0031)

/** 밤 일기 리뷰 → insight 채널.
 * 오늘 일기가 있으면 LLM 1회로 하루 코멘트, 없으면 간단 리마인더 전송. */
const insightNightTask = async (app: App, config: LifeCronConfig): Promise<void> => {
  const today = getEffectiveTodayISO();

  await forEachUser(config, 'insight', '일기 리뷰', async (userId, channelId) => {
    const diaryResult = await query<{ content: string }>(
      `SELECT content FROM diary_entries WHERE user_id = $1 AND date = $2 LIMIT 1`,
      [userId, today],
    );

    const diary = diaryResult.rows[0];

    if (!diary) {
      await postToChannel(
        app.client,
        channelId,
        '오늘 하루는 어땠어? 간단하게라도 일기를 남겨보자.',
      );
      console.warn(`[Life Cron] 일기 없음 — 리마인더 전송 (유저=${userId})`);
      return;
    }

    // 일운 요약 조회 (사주 연결용)
    const fortuneResult = await query<{ summary: string | null; advice: string | null }>(
      `SELECT summary, advice FROM fortune_analyses
       WHERE user_id = $1 AND date = $2 AND period = 'daily'
       ORDER BY created_at DESC LIMIT 1`,
      [userId, today],
    );
    const fortune = fortuneResult.rows[0];
    const fortuneContext = fortune?.summary ? `\n오늘 일운 요약: ${fortune.summary}` : '';

    const context = `오늘 일기:\n${diary.content}${fortuneContext}`;

    const comment = await generateCronMessage(
      config.llmClient,
      INSIGHT_NIGHT_SYSTEM_PROMPT,
      context,
      '오늘도 수고했어. 내일도 좋은 하루 보내자.',
    );

    const diaryBlock = `*오늘의 일기*\n${diary.content}`;
    const message = `${diaryBlock}\n\n---\n\n${comment}`;

    await postToChannel(app.client, channelId, message);
    console.warn(`[Life Cron] 일기 리뷰 전송 완료 (유저=${userId})`);
  });
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
  morning: morningTask,
  night: nightTask,
  weeklyReport: weeklyReportTask,
  insightNight: insightNightTask,
  dailySajuMatching: dailyPatternMatchingTask,
  diaryMetaExtract: diaryMetaExtractTask,
  weeklyVerification: weeklyVerificationTask,
  weeklyReviewFallback: weeklyReviewFallbackTask, // 월 10:00 — routine 미발송 시 수동 실행 알림 (#542 ADR-0052)
  signalSuggestFallback: signalSuggestFallbackTask, // 월 2일 11:00 — monthly-signal-suggest 미실행 시 알림 (#466 ADR-0058)
  discoveryRecommend: discoveryRecommendTask, // 07:30 데일리 — 묶음 전부 패스 시 다음 best (#512 ADR-0047)
  periodFortune: periodFortuneTask, // 08:20 데일리 — 절기/입춘/대운 전환 시 주기 운세 카드 (#529 ADR-0050)
  // pillarLevelDistributionReview 은퇴(#508 ADR-0046) — 누적 시드 강도 밴드 위임으로 분포 리뷰 무의미.
  // 미등록 슬롯은 loadAndSchedule가 graceful skip(if (!taskFn) continue) — DB row 비활성은 가역 정리.
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
  private reminderTimesCache = new Set<string>();
  private reminderCacheUpdatedAt = 0;

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
          const currentTime = getKSTTimeString();

          // 캐시 갱신: 30분마다 또는 최초
          const now = Date.now();
          if (now - this.reminderCacheUpdatedAt > 30 * 60 * 1000) {
            await this.refreshReminderCache();
          }

          // 현재 시각에 리마인더가 없으면 DB 쿼리 스킵
          if (!this.reminderTimesCache.has(currentTime)) return;

          await this.checkDueReminders(currentTime);
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

  private async refreshReminderCache(): Promise<void> {
    this.reminderTimesCache = await queryActiveReminderTimes();
    this.reminderCacheUpdatedAt = Date.now();
    console.warn(`[Life Cron] 리마인더 캐시 갱신: ${this.reminderTimesCache.size}개 시간대`);
  }

  private async checkDueReminders(currentTime?: string): Promise<void> {
    const today = getTodayISO();
    const time = currentTime ?? getKSTTimeString();
    const dow = getKSTDayOfWeek();

    const reminders = await queryDueReminders(today, time, dow);

    for (const reminder of reminders) {
      await postToChannel(this.app.client, this.config.channelId, `리마인더: ${reminder.title}`);

      // 일회성(date 지정) → 자동 비활성화
      if (reminder.date) {
        await deactivateReminder(reminder.id);
        this.reminderCacheUpdatedAt = 0; // 캐시 무효화
        console.warn(`[Life Cron] 일회성 리마인더 비활성화: ${reminder.title}`);
        continue;
      }

      // remaining_count 차감 → 0이면 비활성화
      if (reminder.remaining_count != null && reminder.remaining_count > 0) {
        const deactivated = await decrementReminderCount(reminder.id);
        if (deactivated) {
          this.reminderCacheUpdatedAt = 0; // 캐시 무효화
          console.warn(`[Life Cron] 횟수 소진 리마인더 비활성화: ${reminder.title}`);
          continue;
        }
      }

      // end_date 도달 → 비활성화
      if (reminder.end_date && today >= reminder.end_date) {
        await deactivateReminder(reminder.id);
        this.reminderCacheUpdatedAt = 0; // 캐시 무효화
        console.warn(`[Life Cron] 기간 만료 리마인더 비활성화: ${reminder.title}`);
      }
    }

    if (reminders.length > 0) {
      console.warn(`[Life Cron] 리마인더 ${reminders.length}건 전송 (${time})`);
    }
  }

  private destroyAll(): void {
    for (const task of this.tasks.values()) {
      task.stop();
    }
    this.tasks.clear();
  }
}
