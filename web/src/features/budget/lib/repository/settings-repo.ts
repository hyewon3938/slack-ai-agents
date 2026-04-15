import { query } from '@/lib/db';

// updated_at 미사용 — 신규 facade는 target_date만 읽는다 (Section 3.3)
export async function readTargetMonth(userId: number): Promise<string | null> {
  const result = await query<{ target_date: string | null }>(
    'SELECT target_date FROM budget_settings WHERE user_id = $1',
    [userId],
  );
  return result.rows[0]?.target_date ?? null;
}
