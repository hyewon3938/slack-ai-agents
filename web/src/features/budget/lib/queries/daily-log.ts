import { query } from '@/lib/db';
import { getTodayISO } from '@/lib/kst';
import { getTodayAllocation } from '../facade';
import { getCurrentBillingMonth } from '../billing/cycle';
import { readTodayFlexSpent } from '../repository/expenses-repo';
import type { DailyBudgetLog } from '../types';

// ─── 일별 예산 로그 ──────────────────────────────────────

export type { DailyBudgetLog };

export interface DailyBudgetLogSummary {
  logs: DailyBudgetLog[];
  total_saved: number; // 해당 월 누적 세이브 (음수 = 누적 초과)
  days_logged: number; // 기록된 일수
  avg_daily_saved: number; // 일평균 세이브
}

/**
 * 일별 예산 스냅샷 저장 (Vercel cron에서 호출 — 전일 데이터)
 *
 * @param userId
 * @param opts.targetDate 스냅샷 대상 날짜 (생략 시 KST 오늘).
 *   Cron 핸들러는 `resolvePreviousDayDate(new Date())` 로 전일 날짜를 넘긴다.
 */
export async function saveDailyBudgetLog(
  userId: number,
  opts?: { targetDate?: string },
): Promise<{ date: string; budget: number; spent: number; saved: number }> {
  const targetDate = opts?.targetDate ?? getTodayISO();
  // T12:00:00Z = KST 21:00 → 당일 날짜 유지 (드리프트 보정은 호출 측에서 처리)
  const now = new Date(`${targetDate}T12:00:00Z`);

  // 일별 로그는 기준 일 예산(todayBudget) 기준으로 평가 — 사이클 시작 시 약속된
  // anchor 대비 그날 얼마나 잘 지켰는지가 누적 분석(세이브 합계, 일평균, 런웨이 환산)과 정합.
  const daily = await getTodayAllocation(userId, now);
  const budget = daily.todayBudget;
  const billingMonth = getCurrentBillingMonth(now);

  // targetDate의 자유 지출은 readTodayFlexSpent 단일 정의 사용 (SSOT)
  const spent = await readTodayFlexSpent(userId, targetDate, billingMonth);

  const saved = budget - spent;

  // UPSERT: 같은 날 다시 실행해도 최신 값으로 갱신
  await query(
    `INSERT INTO daily_budget_logs (user_id, date, billing_month, budget, spent, saved)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, date)
     DO UPDATE SET budget = $4, spent = $5, saved = $6, billing_month = $3`,
    [userId, targetDate, billingMonth, budget, spent, saved],
  );

  return { date: targetDate, budget, spent, saved };
}

/** billing_month 기준 일별 예산 로그 조회 */
export async function queryDailyBudgetLogs(
  userId: number,
  billingMonth: string,
): Promise<DailyBudgetLogSummary> {
  const { rows } = await query<DailyBudgetLog>(
    `SELECT date::text, billing_month, budget, spent, saved
     FROM daily_budget_logs
     WHERE user_id = $1 AND billing_month = $2
     ORDER BY date DESC`,
    [userId, billingMonth],
  );

  const totalSaved = rows.reduce((s, r) => s + r.saved, 0);
  const daysLogged = rows.length;

  return {
    logs: rows,
    total_saved: totalSaved,
    days_logged: daysLogged,
    avg_daily_saved: daysLogged > 0 ? Math.round(totalSaved / daysLogged) : 0,
  };
}
