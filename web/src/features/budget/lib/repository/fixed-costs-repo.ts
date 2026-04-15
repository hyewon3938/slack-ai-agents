import { query } from '@/lib/db';

export async function readFixedCostsMonthlyTotal(userId: number): Promise<number> {
  const result = await query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS total
     FROM fixed_costs
     WHERE user_id = $1 AND COALESCE(active, true) = true`,
    [userId],
  );
  return Number(result.rows[0]?.total ?? 0);
}
