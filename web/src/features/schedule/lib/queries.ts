import { query, queryOne } from '@/lib/db';
import type { ScheduleRow, CategoryRow } from '@/lib/types';

// ─── 일정 조회 ──────────────────────────────────────────

/** 날짜 범위 일정 조회 (캘린더용) */
export const querySchedulesByRange = async (
  from: string,
  to: string,
): Promise<ScheduleRow[]> =>
  (
    await query<ScheduleRow>(
      `SELECT id, title, date::text, end_date::text, status, category, memo, important
       FROM schedules
       WHERE (date >= $1 AND date <= $2) OR (date <= $2 AND end_date >= $1)
       ORDER BY date NULLS LAST,
         CASE status WHEN 'in-progress' THEN 0 WHEN 'todo' THEN 1 WHEN 'done' THEN 2 WHEN 'cancelled' THEN 3 ELSE 4 END,
         category NULLS LAST, title`,
      [from, to],
    )
  ).rows;

/** 백로그 조회 (날짜 미지정) */
export const queryBacklogSchedules = async (): Promise<ScheduleRow[]> =>
  (
    await query<ScheduleRow>(
      `SELECT id, title, date::text, end_date::text, status, category, memo, important
       FROM schedules
       WHERE date IS NULL
       ORDER BY
         CASE status WHEN 'in-progress' THEN 0 WHEN 'todo' THEN 1 WHEN 'done' THEN 2 WHEN 'cancelled' THEN 3 ELSE 4 END,
         category NULLS LAST, important DESC, title`,
    )
  ).rows;

/** 단건 조회 */
export const queryScheduleById = async (id: number): Promise<ScheduleRow | null> =>
  queryOne<ScheduleRow>(
    `SELECT id, title, date::text, end_date::text, status, category, memo, important
     FROM schedules WHERE id = $1`,
    [id],
  );

// ─── 일정 변경 ──────────────────────────────────────────

export const createSchedule = async (data: {
  title: string;
  date?: string | null;
  end_date?: string | null;
  status?: string;
  category?: string | null;
  memo?: string | null;
  important?: boolean;
}): Promise<ScheduleRow> => {
  const result = await query<ScheduleRow>(
    `INSERT INTO schedules (title, date, end_date, status, category, memo, important)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, title, date::text, end_date::text, status, category, memo, important`,
    [
      data.title,
      data.date ?? null,
      data.end_date ?? null,
      data.status ?? 'todo',
      data.category ?? null,
      data.memo ?? null,
      data.important ?? false,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('createSchedule: INSERT returned no rows');
  return row;
};

const SCHEDULE_COLUMNS = new Set([
  'title', 'date', 'end_date', 'status', 'category', 'memo', 'important',
]);

export const updateSchedule = async (
  id: number,
  data: Partial<{
    title: string;
    date: string | null;
    end_date: string | null;
    status: string;
    category: string | null;
    memo: string | null;
    important: boolean;
  }>,
): Promise<ScheduleRow | null> => {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined && SCHEDULE_COLUMNS.has(key)) {
      fields.push(`${key} = $${idx}`);
      values.push(value);
      idx++;
    }
  }

  if (fields.length === 0) return queryScheduleById(id);

  values.push(id);
  const result = await query<ScheduleRow>(
    `UPDATE schedules SET ${fields.join(', ')} WHERE id = $${idx}
     RETURNING id, title, date::text, end_date::text, status, category, memo, important`,
    values,
  );
  return result.rows[0] ?? null;
};

export const deleteSchedule = async (id: number): Promise<boolean> => {
  const result = await query('DELETE FROM schedules WHERE id = $1', [id]);
  return result.rowCount !== null && result.rowCount > 0;
};

// ─── 카테고리 ──────────────────────────────────────────

export const queryCategories = async (): Promise<CategoryRow[]> =>
  (
    await query<CategoryRow>(
      'SELECT id, name, color, sort_order FROM categories ORDER BY sort_order, name',
    )
  ).rows;

export const createCategory = async (data: {
  name: string;
  color?: string;
}): Promise<CategoryRow> => {
  const maxOrder = await queryOne<{ max: number }>(
    'SELECT COALESCE(MAX(sort_order), 0) as max FROM categories',
  );
  const result = await query<CategoryRow>(
    `INSERT INTO categories (name, color, sort_order)
     VALUES ($1, $2, $3)
     RETURNING id, name, color, sort_order`,
    [data.name, data.color ?? 'gray', (maxOrder?.max ?? 0) + 1],
  );
  const row = result.rows[0];
  if (!row) throw new Error('createCategory: INSERT returned no rows');
  return row;
};

const CATEGORY_COLUMNS = new Set(['name', 'color', 'sort_order']);

export const updateCategory = async (
  id: number,
  data: Partial<{ name: string; color: string; sort_order: number }>,
): Promise<CategoryRow | null> => {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined && CATEGORY_COLUMNS.has(key)) {
      fields.push(`${key} = $${idx}`);
      values.push(value);
      idx++;
    }
  }

  if (fields.length === 0) return null;

  values.push(id);
  const result = await query<CategoryRow>(
    `UPDATE categories SET ${fields.join(', ')} WHERE id = $${idx}
     RETURNING id, name, color, sort_order`,
    values,
  );
  return result.rows[0] ?? null;
};

export const deleteCategory = async (id: number): Promise<boolean> => {
  const result = await query('DELETE FROM categories WHERE id = $1', [id]);
  return result.rowCount !== null && result.rowCount > 0;
};

/** 카테고리 순서 일괄 업데이트 */
export const reorderCategories = async (
  orders: { id: number; sort_order: number }[],
): Promise<void> => {
  for (const { id, sort_order } of orders) {
    await query('UPDATE categories SET sort_order = $1 WHERE id = $2', [sort_order, id]);
  }
};

/** 일정에서 사용 중인 카테고리가 categories 테이블에 없으면 자동 추가 */
export const ensureCategoryExists = async (name: string): Promise<void> => {
  const existing = await queryOne<CategoryRow>(
    'SELECT id, name, color, sort_order FROM categories WHERE name = $1',
    [name],
  );
  if (!existing) {
    await createCategory({ name });
  }
};
