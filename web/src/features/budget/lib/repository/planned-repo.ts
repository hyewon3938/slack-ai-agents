import { query } from '@/lib/db';
import type { PlannedInput } from '../types-v2';

export async function readPlannedExpenses(
  userId: number,
  fromYearMonth: string,
  toYearMonth: string,
): Promise<PlannedInput[]> {
  const result = await query<{ year_month: string; amount: number }>(
    `SELECT year_month, SUM(amount)::int AS amount
     FROM planned_expenses
     WHERE user_id = $1 AND year_month BETWEEN $2 AND $3
     GROUP BY year_month`,
    [userId, fromYearMonth, toYearMonth],
  );
  return result.rows.map((r) => ({ yearMonth: r.year_month, amount: r.amount }));
}
