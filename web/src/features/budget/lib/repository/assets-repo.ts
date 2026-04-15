import { query } from '@/lib/db';

export async function readTotalAssetBalance(userId: number): Promise<number> {
  const result = await query<{ total: string }>(
    `SELECT COALESCE(SUM(balance), 0)::text AS total
     FROM assets WHERE user_id = $1`,
    [userId],
  );
  return Number(result.rows[0]?.total ?? 0);
}
