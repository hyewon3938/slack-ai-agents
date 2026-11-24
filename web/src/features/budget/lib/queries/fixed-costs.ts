import { query, queryOne } from '@/lib/db';
import type { FixedCostRow } from '../types';

// ─── 고정비 ───────────────────────────────────────────

/** 고정비 수정 */
const FIXED_COST_COLUMNS = new Set([
  'name',
  'amount',
  'category',
  'is_variable',
  'day_of_month',
  'active',
  'memo',
  'payment_method',
]);

export async function updateFixedCost(
  userId: number,
  id: number,
  updates: Record<string, unknown>,
): Promise<FixedCostRow | null> {
  // undefined는 "안 바꿈"으로 건너뛴다. null은 nullable 컬럼(category·day_of_month·memo·payment_method)을
  // 비우는 값이라 그대로 반영한다. NOT NULL 컬럼의 null은 route 검증이 먼저 막는다.
  const keys = Object.keys(updates).filter(
    (k) => FIXED_COST_COLUMNS.has(k) && updates[k] !== undefined,
  );
  if (keys.length === 0) return null;

  const setClauses = keys.map((k, i) => `${k} = $${i + 3}`);
  const values = keys.map((k) => updates[k]);
  return queryOne<FixedCostRow>(
    `UPDATE fixed_costs SET ${setClauses.join(', ')}
     WHERE id = $1 AND user_id = $2
     RETURNING id, name, amount, category, is_variable, day_of_month, active, memo, payment_method`,
    [id, userId, ...values],
  );
}

/** 고정비 생성 */
export async function createFixedCost(
  userId: number,
  data: {
    name: string;
    amount: number;
    category?: string | null;
    day_of_month?: number | null;
    payment_method?: string | null;
  },
): Promise<FixedCostRow> {
  const row = await queryOne<FixedCostRow>(
    `INSERT INTO fixed_costs (user_id, name, amount, category, day_of_month, payment_method)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, amount, category, is_variable, day_of_month, active, memo, payment_method`,
    [
      userId,
      data.name,
      data.amount,
      data.category ?? null,
      data.day_of_month ?? null,
      data.payment_method ?? null,
    ],
  );
  if (!row) throw new Error('createFixedCost: INSERT returned no rows');
  return row;
}

/** 고정비 삭제 */
export async function deleteFixedCost(userId: number, id: number): Promise<boolean> {
  const result = await query(`DELETE FROM fixed_costs WHERE id = $1 AND user_id = $2`, [
    id,
    userId,
  ]);
  return (result.rowCount ?? 0) > 0;
}
