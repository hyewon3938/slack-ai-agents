import { query } from '@/lib/db';

/**
 * 예산 배분 가능한 자산 합계.
 * - available_amount: 이미 묶인 돈(다음달 카드값 등) 제외한 실제 가용 자금
 * - is_emergency=false: 비상금 제외
 */
export async function readDistributableAssetBalance(userId: number): Promise<number> {
  const result = await query<{ total: string }>(
    `SELECT COALESCE(SUM(available_amount), 0)::text AS total
     FROM assets WHERE user_id = $1 AND is_emergency = false`,
    [userId],
  );
  return Number(result.rows[0]?.total ?? 0);
}
