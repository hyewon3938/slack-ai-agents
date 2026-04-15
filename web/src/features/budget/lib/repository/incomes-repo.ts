import { query } from '@/lib/db';

// incomes 테이블 + expenses.type='income' 양쪽 통합 (레거시 병존 구조)
export async function readIncomeTotal(
  userId: number,
  from: string,
  to: string,
): Promise<number> {
  const result = await query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS total FROM (
       SELECT amount FROM incomes
        WHERE user_id = $1 AND date BETWEEN $2 AND $3
       UNION ALL
       SELECT amount FROM expenses
        WHERE user_id = $1 AND type = 'income' AND date BETWEEN $2 AND $3
     ) AS combined`,
    [userId, from, to],
  );
  return Number(result.rows[0]?.total ?? 0);
}

// 축 A — 자산에 흘러드는 수입만 합산 (distribute_to_budget=true + 레거시 incomes)
export async function readDistributableIncomeTotal(
  userId: number,
  from: string,
  to: string,
): Promise<number> {
  const result = await query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS total FROM (
       SELECT amount FROM incomes
        WHERE user_id = $1 AND date BETWEEN $2 AND $3
       UNION ALL
       SELECT amount FROM expenses
        WHERE user_id = $1 AND type = 'income'
          AND COALESCE(distribute_to_budget, false) = true
          AND date BETWEEN $2 AND $3
     ) AS combined`,
    [userId, from, to],
  );
  return Number(result.rows[0]?.total ?? 0);
}
