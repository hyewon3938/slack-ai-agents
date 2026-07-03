import { query } from '@/lib/db';

// 수입 합계 — expenses.type='income' 을 billing_month 기준으로 집계.
export async function readIncomeTotal(userId: number, billingMonth: string): Promise<number> {
  const result = await query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS total
     FROM expenses
     WHERE user_id = $1 AND type = 'income' AND billing_month = $2`,
    [userId, billingMonth],
  );
  return Number(result.rows[0]?.total ?? 0);
}

// 이번 달만 반영 — distribute_to_budget=false 인 expenses.type='income' 만 (현재 월 free 에 독점 귀속)
export async function readCurrentMonthOnlyIncome(
  userId: number,
  billingMonth: string,
  upToDate: string,
): Promise<number> {
  const result = await query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS total
     FROM expenses
     WHERE user_id = $1
       AND type = 'income'
       AND COALESCE(distribute_to_budget, false) = false
       AND billing_month = $2
       AND date <= $3`,
    [userId, billingMonth, upToDate],
  );
  return Number(result.rows[0]?.total ?? 0);
}
