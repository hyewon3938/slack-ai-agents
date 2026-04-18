import { query } from '@/lib/db';

export async function readFlexibleSpent(
  userId: number,
  billingMonth: string,
  upToDate: string,
): Promise<number> {
  const result = await query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS total
     FROM expenses
     WHERE user_id = $1
       AND COALESCE(type, 'expense') = 'expense'
       AND exclude_from_budget = false
       AND is_installment = false
       AND planned_expense_id IS NULL
       AND billing_month = $2
       AND date <= $3`,
    [userId, billingMonth, upToDate],
  );
  return Number(result.rows[0]?.total ?? 0);
}

export async function readExcludedSpent(
  userId: number,
  billingMonth: string,
): Promise<number> {
  const result = await query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS total
     FROM expenses
     WHERE user_id = $1
       AND COALESCE(type, 'expense') = 'expense'
       AND exclude_from_budget = true
       AND billing_month = $2`,
    [userId, billingMonth],
  );
  return Number(result.rows[0]?.total ?? 0);
}

export async function readTodayFlexSpent(
  userId: number,
  today: string,
): Promise<number> {
  const result = await query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS total
     FROM expenses
     WHERE user_id = $1
       AND COALESCE(type, 'expense') = 'expense'
       AND exclude_from_budget = false
       AND is_installment = false
       AND planned_expense_id IS NULL
       AND date = $2::date`,
    [userId, today],
  );
  return Number(result.rows[0]?.total ?? 0);
}

/** 최근 N개월 변동 지출 월평균 (고정비 제외 일반 지출만) */
export async function readAvgVariableMonthly(
  userId: number,
  months = 3,
): Promise<number> {
  const result = await query<{ avg_monthly: string }>(
    `SELECT COALESCE(AVG(monthly_total), 0) AS avg_monthly
     FROM (
       SELECT DATE_TRUNC('month', date) AS month, SUM(amount) AS monthly_total
       FROM expenses
       WHERE user_id = $1
         AND date >= NOW() - ($2::text || ' months')::interval
         AND exclude_from_budget = false
         AND COALESCE(type, 'expense') = 'expense'
       GROUP BY 1
     ) sub`,
    [userId, months],
  );
  return Math.round(Number(result.rows[0]?.avg_monthly ?? 0));
}
