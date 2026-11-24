import { query, queryOne } from '@/lib/db';
import type { PlannedExpenseRow } from '../types';

// ─── 예정 지출 ────────────────────────────────────────

/** 예정 지출 목록 조회 (사용 금액 포함) */
export async function queryPlannedExpenses(
  userId: number,
  yearMonth?: string,
): Promise<PlannedExpenseRow[]> {
  const condition = yearMonth ? 'AND p.year_month = $2' : '';
  const params: unknown[] = yearMonth ? [userId, yearMonth] : [userId];
  const { rows } = await query<PlannedExpenseRow>(
    `SELECT p.id, p.year_month, p.amount, p.memo, p.created_at::text,
            COALESCE(SUM(e.amount), 0)::integer as used_amount
     FROM planned_expenses p
     LEFT JOIN expenses e ON e.planned_expense_id = p.id AND e.user_id = p.user_id
     WHERE p.user_id = $1 ${condition}
     GROUP BY p.id
     ORDER BY p.year_month, p.created_at`,
    params,
  );
  return rows;
}

/** 예정 지출이 이 유저의 것인가 — 지출에 연결하기 전에 확인한다 */
export async function isPlannedExpenseOwned(userId: number, id: number): Promise<boolean> {
  const row = await queryOne<{ id: number }>(
    'SELECT id FROM planned_expenses WHERE id = $1 AND user_id = $2',
    [id, userId],
  );
  return row !== null;
}

/** 예정 지출 추가 */
export async function createPlannedExpense(
  userId: number,
  data: { year_month: string; amount: number; memo?: string | null },
): Promise<PlannedExpenseRow> {
  const row = await queryOne<PlannedExpenseRow>(
    `INSERT INTO planned_expenses (user_id, year_month, amount, memo)
     VALUES ($1, $2, $3, $4)
     RETURNING id, year_month, amount, memo, created_at::text`,
    [userId, data.year_month, data.amount, data.memo ?? null],
  );
  if (!row) throw new Error('createPlannedExpense: INSERT returned no rows');
  return row;
}

/** 예정 지출 수정 */
export async function updatePlannedExpense(
  userId: number,
  id: number,
  data: { amount?: number; memo?: string | null },
): Promise<PlannedExpenseRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [id, userId];
  if (data.amount !== undefined) {
    sets.push(`amount = $${values.length + 1}`);
    values.push(data.amount);
  }
  if (data.memo !== undefined) {
    sets.push(`memo = $${values.length + 1}`);
    values.push(data.memo);
  }
  if (sets.length === 0) return null;
  return queryOne<PlannedExpenseRow>(
    `UPDATE planned_expenses SET ${sets.join(', ')}
     WHERE id = $1 AND user_id = $2
     RETURNING id, year_month, amount, memo, created_at::text`,
    values,
  );
}

/** 예정 지출 삭제 */
export async function deletePlannedExpense(userId: number, id: number): Promise<boolean> {
  const result = await query('DELETE FROM planned_expenses WHERE id = $1 AND user_id = $2', [
    id,
    userId,
  ]);
  return (result.rowCount ?? 0) > 0;
}
