import { query } from '@/lib/db';

/**
 * 목표 기간 창 [fromMonth, toMonth] 안의 할부 회차를 billing_month별로 합산 (#539, ADR 0051).
 *
 * 창 안의 모든 할부 회차가 "묶인 돈"(reservation) — 건별 토글·exclude 무관, 할부면 전부 포함.
 * 1회차(현재월)도 자기 billing_month 락에 귀속되어 현재 주기 자유 예산을 깎는다.
 * 창 밖(target_date 이후) 회차는 조회되지 않아 예산에서 자동 제외된다.
 *
 * @returns Map<billing_month, 그 달 할부 합계>. 할부 없는 달은 키 자체가 없음(allocator가 0 처리).
 */
export async function readInstallmentLockByMonth(
  userId: number,
  fromMonth: string,
  toMonth: string,
): Promise<Map<string, number>> {
  const result = await query<{ billing_month: string; total: number }>(
    `SELECT billing_month, COALESCE(SUM(amount), 0)::int AS total
       FROM expenses
      WHERE user_id = $1
        AND is_installment = true
        AND COALESCE(type, 'expense') = 'expense'
        AND billing_month BETWEEN $2 AND $3
      GROUP BY billing_month`,
    [userId, fromMonth, toMonth],
  );
  return new Map(result.rows.map((r) => [r.billing_month, r.total]));
}
