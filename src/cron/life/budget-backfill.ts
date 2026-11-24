import type { App } from '@slack/bolt';
import { query } from '../../shared/db.js';
import { postToChannel } from '../../shared/slack.js';
import { getYesterdayISO, addDays } from '../../shared/kst.js';

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
export const CYCLE_END_DAY = CYCLE_START_DAY - 1;

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

/**
 * 어제자 daily_budget_logs 누락 감지 → 직접 INSERT 백필.
 * - budget: 같은 billing_month의 직전 로그에서 복제 (allocation 로직 미복제 — 웹 없이는 재현 불가)
 * - spent: 웹 readTodayFlexSpent(ADR-0007 SSOT)의 복제본 = directFlex(비할부) + 일별 plannedOverflow 증가분.
 *   웹 정의 변경 시 이 함수 + 테스트를 동기화할 것.
 * - 백필 발생 시 #project 채널로 Slack 알림
 */
export const backfillYesterdayBudgetLogIfMissing = async (app: App): Promise<void> => {
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
