import { query } from '@/lib/db';

export async function readTargetMonth(userId: number): Promise<string | null> {
  const result = await query<{ target_date: string | null }>(
    'SELECT target_date FROM budget_settings WHERE user_id = $1',
    [userId],
  );
  return result.rows[0]?.target_date ?? null;
}

// target_date 변경은 단순 upsert만 (#539, ADR 0051).
// 묶인 돈은 목표 기간 창 기준 라이브 계산이라, 창이 바뀌면 다음 예산 조회에서 자동 반영된다.
// → 변경 시점에 자산을 보정할 필요가 없다(등록 시점 차감 폐지). 건별 토글·영향 분석도 제거.
export async function upsertTargetDate(userId: number, targetDate: string | null): Promise<void> {
  await query(
    `INSERT INTO budget_settings (user_id, target_date, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE
     SET target_date = EXCLUDED.target_date, updated_at = NOW()`,
    [userId, targetDate],
  );
}
