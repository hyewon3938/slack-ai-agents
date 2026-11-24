import { query, queryOne } from '@/lib/db';
import type { AssetRow } from '../types';

// ─── 자산 ─────────────────────────────────────────────

/** 자산 목록 */
export async function queryAssets(userId: number): Promise<AssetRow[]> {
  const { rows } = await query<AssetRow>(
    `SELECT id, name, balance, type, available_amount, is_emergency,
            COALESCE(is_default, false) as is_default, memo, updated_at::text, balance_as_of::text
     FROM assets WHERE user_id = $1
     ORDER BY is_emergency ASC, is_default DESC, type, name`,
    [userId],
  );
  return rows;
}

/** 자산 잔액 수정 */
export async function updateAsset(
  userId: number,
  id: number,
  data: {
    balance?: number;
    available_amount?: number;
    memo?: string | null;
    /** 이 잔액이 며칠까지의 입출금을 반영한 값인가 (#615) */
    balance_as_of?: string;
  },
): Promise<AssetRow | null> {
  return queryOne<AssetRow>(
    `UPDATE assets
     SET balance = COALESCE($3, balance),
         available_amount = COALESCE($4, available_amount),
         memo = COALESCE($5, memo),
         balance_as_of = COALESCE($6::date, balance_as_of),
         updated_at = NOW()
     WHERE id = $1 AND user_id = $2
     RETURNING id, name, balance, type, available_amount, is_emergency,
               COALESCE(is_default, false) as is_default, memo, updated_at::text, balance_as_of::text`,
    [
      id,
      userId,
      data.balance ?? null,
      data.available_amount ?? null,
      data.memo ?? null,
      data.balance_as_of ?? null,
    ],
  );
}

/**
 * 기본 자산 지정 — user당 1개만 true.
 * 비상금(is_emergency=true) 자산은 default로 지정 불가.
 * 기존 default가 있으면 해제 후 신규 지정 (partial unique index 충돌 방지).
 */
export async function setDefaultAsset(userId: number, id: number): Promise<AssetRow | null> {
  const target = await queryOne<{ is_emergency: boolean }>(
    `SELECT is_emergency FROM assets WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  if (!target) return null;
  if (target.is_emergency) {
    throw new Error('EMERGENCY_ASSET_CANNOT_BE_DEFAULT');
  }
  await query(`UPDATE assets SET is_default = false WHERE user_id = $1 AND is_default = true`, [
    userId,
  ]);
  return queryOne<AssetRow>(
    `UPDATE assets SET is_default = true, updated_at = NOW()
     WHERE id = $1 AND user_id = $2
     RETURNING id, name, balance, type, available_amount, is_emergency,
               COALESCE(is_default, false) as is_default, memo, updated_at::text, balance_as_of::text`,
    [id, userId],
  );
}

/** 기본 자산 해제 */
export async function clearDefaultAsset(userId: number, id: number): Promise<AssetRow | null> {
  return queryOne<AssetRow>(
    `UPDATE assets SET is_default = false, updated_at = NOW()
     WHERE id = $1 AND user_id = $2
     RETURNING id, name, balance, type, available_amount, is_emergency,
               COALESCE(is_default, false) as is_default, memo, updated_at::text, balance_as_of::text`,
    [id, userId],
  );
}
