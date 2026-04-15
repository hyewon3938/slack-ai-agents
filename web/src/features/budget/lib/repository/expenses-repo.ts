import { query } from '@/lib/db';

export async function readFlexibleSpent(
  userId: number,
  from: string,
  to: string,
): Promise<number> {
  const result = await query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS total
     FROM expenses
     WHERE user_id = $1
       AND COALESCE(type, 'expense') = 'expense'
       AND exclude_from_budget = false
       AND is_installment = false
       AND date BETWEEN $2 AND $3`,
    [userId, from, to],
  );
  return Number(result.rows[0]?.total ?? 0);
}

export async function readExcludedSpent(
  userId: number,
  from: string,
  to: string,
): Promise<number> {
  const result = await query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS total
     FROM expenses
     WHERE user_id = $1
       AND COALESCE(type, 'expense') = 'expense'
       AND exclude_from_budget = true
       AND date BETWEEN $2 AND $3`,
    [userId, from, to],
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
       AND date = $2::date`,
    [userId, today],
  );
  return Number(result.rows[0]?.total ?? 0);
}
