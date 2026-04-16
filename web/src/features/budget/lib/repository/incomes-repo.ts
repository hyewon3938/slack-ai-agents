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

// 이번 달만 반영 — distribute_to_budget=false 인 expenses.type='income' 만 (현재 월 free 에 독점 귀속)
// 레거시 incomes 테이블은 항상 전체 분배로 간주하므로 제외.
export async function readCurrentMonthOnlyIncome(
  userId: number,
  from: string,
  to: string,
): Promise<number> {
  const result = await query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS total
     FROM expenses
     WHERE user_id = $1
       AND type = 'income'
       AND COALESCE(distribute_to_budget, false) = false
       AND date BETWEEN $2 AND $3`,
    [userId, from, to],
  );
  return Number(result.rows[0]?.total ?? 0);
}
