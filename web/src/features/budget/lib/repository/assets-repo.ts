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

/** 자동 차감/증액 실제 반영 내역 (감사/로그용) */
export interface AssetMutation {
  assetId: number;
  delta: number;
}

/** is_default=true 자산 ID 반환. 없으면 null */
export async function getDefaultAssetId(userId: number): Promise<number | null> {
  const result = await query<{ id: number }>(
    `SELECT id FROM assets WHERE user_id = $1 AND is_default = true LIMIT 1`,
    [userId],
  );
  return result.rows[0]?.id ?? null;
}

/**
 * 자산 차감 — default 자산 우선, 부족 시 is_emergency=false 자산으로 fallback.
 * 마지막 fallback 자산에선 음수 허용 (마이너스 통장 의미상).
 * available_amount만 변동 (balance는 사용자가 수기로 갱신).
 */
export async function applyAssetDeduction(
  userId: number,
  amount: number,
): Promise<AssetMutation[]> {
  if (amount <= 0) return [];

  const candidates = await query<{ id: number; available_amount: number }>(
    `SELECT id, available_amount
     FROM assets
     WHERE user_id = $1 AND is_emergency = false
     ORDER BY is_default DESC, available_amount DESC, id ASC`,
    [userId],
  );

  if (candidates.rows.length === 0) return [];

  let remaining = amount;
  const mutations: AssetMutation[] = [];
  const last = candidates.rows[candidates.rows.length - 1]!;

  for (const asset of candidates.rows) {
    if (remaining <= 0) break;
    const isLast = asset.id === last.id;
    const available = Math.max(0, asset.available_amount);
    const delta = isLast ? remaining : Math.min(available, remaining);
    if (delta <= 0) continue;
    await query(
      `UPDATE assets SET available_amount = available_amount - $1, updated_at = NOW() WHERE id = $2`,
      [delta, asset.id],
    );
    mutations.push({ assetId: asset.id, delta: -delta });
    remaining -= delta;
  }
  return mutations;
}

/**
 * 자산 증액 — default 자산에 단순 증액 (분배 없음).
 * default 없으면 is_emergency=false인 첫 자산.
 */
export async function applyAssetIncrease(userId: number, amount: number): Promise<AssetMutation[]> {
  if (amount <= 0) return [];

  let assetId = await getDefaultAssetId(userId);
  if (assetId === null) {
    const fallback = await query<{ id: number }>(
      `SELECT id FROM assets WHERE user_id = $1 AND is_emergency = false ORDER BY id LIMIT 1`,
      [userId],
    );
    assetId = fallback.rows[0]?.id ?? null;
  }
  if (assetId === null) return [];

  await query(
    `UPDATE assets SET available_amount = available_amount + $1, updated_at = NOW() WHERE id = $2`,
    [amount, assetId],
  );
  return [{ assetId, delta: amount }];
}
