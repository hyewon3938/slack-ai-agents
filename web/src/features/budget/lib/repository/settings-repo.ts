import { query } from '@/lib/db';

export async function readTargetMonth(userId: number): Promise<string | null> {
  const result = await query<{ target_date: string | null }>(
    'SELECT target_date FROM budget_settings WHERE user_id = $1',
    [userId],
  );
  return result.rows[0]?.target_date ?? null;
}


export async function upsertTargetDate(
  userId: number,
  targetDate: string | null,
): Promise<void> {
  await query(
    `INSERT INTO budget_settings (user_id, target_date, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE
     SET target_date = EXCLUDED.target_date, updated_at = NOW()`,
    [userId, targetDate],
  );
}
