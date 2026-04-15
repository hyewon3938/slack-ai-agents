import { query } from '@/lib/db';

export async function readTargetMonth(userId: number): Promise<string | null> {
  const result = await query<{ target_date: string | null }>(
    'SELECT target_date FROM budget_settings WHERE user_id = $1',
    [userId],
  );
  return result.rows[0]?.target_date ?? null;
}

/** 예산 시작일 (budget_settings.updated_at) — 이 날짜 이전 지출은 과거 취급 */
export async function readBudgetStartAt(userId: number): Promise<string | null> {
  const result = await query<{ updated_at: string | null }>(
    'SELECT updated_at::text FROM budget_settings WHERE user_id = $1',
    [userId],
  );
  return result.rows[0]?.updated_at ?? null;
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
