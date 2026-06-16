import { query, queryOne } from '@/lib/db';
import type { CategoryLimitRow, CategoryLimitWithUsage } from '../types';

/**
 * 카테고리 한도 + 현재 주기 사용 횟수 조회.
 * used_count는 expenses에서 live 집계 — 할부는 1회차만 카운트, income 제외, 예산 미포함(exclude) 제외.
 */
export async function readCategoryLimitsWithUsage(
  userId: number,
  billingMonth: string,
): Promise<CategoryLimitWithUsage[]> {
  const result = await query<CategoryLimitWithUsage>(
    `SELECT
       cl.id,
       cl.category,
       cl.target_count,
       COALESCE((
         SELECT COUNT(*)::int FROM expenses e
         WHERE e.user_id = cl.user_id
           AND e.billing_month = $2
           AND e.category = cl.category
           AND e.type = 'expense'
           AND COALESCE(e.exclude_from_budget, false) = false
           AND (e.is_installment = false OR e.installment_num = 1)
       ), 0) AS used_count
     FROM category_limits cl
     WHERE cl.user_id = $1
     ORDER BY cl.id`,
    [userId, billingMonth],
  );
  return result.rows;
}

export async function readCategoryLimits(userId: number): Promise<CategoryLimitRow[]> {
  const result = await query<CategoryLimitRow>(
    `SELECT * FROM category_limits WHERE user_id = $1 ORDER BY id`,
    [userId],
  );
  return result.rows;
}

export async function createCategoryLimit(
  userId: number,
  input: { category: string; target_count: number },
): Promise<CategoryLimitRow> {
  const row = await queryOne<CategoryLimitRow>(
    `INSERT INTO category_limits (user_id, category, target_count)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [userId, input.category, input.target_count],
  );
  if (!row) throw new Error('createCategoryLimit: INSERT returned no rows');
  return row;
}

export async function updateCategoryLimit(
  userId: number,
  id: number,
  updates: { target_count?: number },
): Promise<CategoryLimitRow | null> {
  if (updates.target_count === undefined) return null;
  return queryOne<CategoryLimitRow>(
    `UPDATE category_limits
     SET target_count = $3, updated_at = NOW()
     WHERE id = $2 AND user_id = $1
     RETURNING *`,
    [userId, id, updates.target_count],
  );
}

export async function deleteCategoryLimit(userId: number, id: number): Promise<boolean> {
  const result = await query(`DELETE FROM category_limits WHERE id = $2 AND user_id = $1`, [
    userId,
    id,
  ]);
  return (result.rowCount ?? 0) > 0;
}
