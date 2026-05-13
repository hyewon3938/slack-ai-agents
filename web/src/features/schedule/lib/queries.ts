import { query, queryOne } from '@/lib/db';
import type { ScheduleRow } from '@/features/schedule/lib/types';
import type { CategoryRow } from '@/lib/types';

// ─── 일정 조회 ──────────────────────────────────────────

const SCHEDULE_SELECT = `s.id, s.title, s.date::text, s.end_date::text, s.status,
  s.category_id, s.memo, s.important`;

// 클라이언트에서 categories store와 join하므로 SELECT는 단순 FK만 반환.
// 정렬 보조용 최상위 카테고리 이름은 ORDER BY 단계에서만 사용.

/** 날짜 범위 일정 조회 (캘린더용) */
export const querySchedulesByRange = async (
  userId: number,
  from: string,
  to: string,
): Promise<ScheduleRow[]> =>
  (
    await query<ScheduleRow>(
      `SELECT ${SCHEDULE_SELECT}
       FROM schedules s
       LEFT JOIN categories c ON c.id = s.category_id
       LEFT JOIN categories p ON p.id = c.parent_id
       WHERE s.user_id = $1 AND ((s.date >= $2 AND s.date <= $3) OR (s.date <= $3 AND s.end_date >= $2))
       ORDER BY s.date NULLS LAST,
         CASE s.status WHEN 'in-progress' THEN 0 WHEN 'todo' THEN 1 WHEN 'done' THEN 2 WHEN 'cancelled' THEN 3 ELSE 4 END,
         COALESCE(p.name, c.name) NULLS LAST,
         c.name NULLS LAST,
         s.title`,
      [userId, from, to],
    )
  ).rows;

/** 백로그 조회 (날짜 미지정) */
export const queryBacklogSchedules = async (userId: number): Promise<ScheduleRow[]> =>
  (
    await query<ScheduleRow>(
      `SELECT ${SCHEDULE_SELECT}
       FROM schedules s
       LEFT JOIN categories c ON c.id = s.category_id
       LEFT JOIN categories p ON p.id = c.parent_id
       WHERE s.user_id = $1 AND s.date IS NULL
       ORDER BY
         CASE s.status WHEN 'in-progress' THEN 0 WHEN 'todo' THEN 1 WHEN 'done' THEN 2 WHEN 'cancelled' THEN 3 ELSE 4 END,
         COALESCE(p.name, c.name) NULLS LAST,
         c.name NULLS LAST,
         s.important DESC, s.title`,
      [userId],
    )
  ).rows;

/** 단건 조회 (userId로 소유권 확인) */
export const queryScheduleById = async (userId: number, id: number): Promise<ScheduleRow | null> =>
  queryOne<ScheduleRow>(
    `SELECT ${SCHEDULE_SELECT}
     FROM schedules s
     WHERE s.user_id = $1 AND s.id = $2`,
    [userId, id],
  );

// ─── 일정 변경 ──────────────────────────────────────────

export const createSchedule = async (
  userId: number,
  data: {
    title: string;
    date?: string | null;
    end_date?: string | null;
    status?: string;
    category_id?: number | null;
    memo?: string | null;
    important?: boolean;
  },
): Promise<ScheduleRow> => {
  const result = await query<ScheduleRow>(
    `INSERT INTO schedules (user_id, title, date, end_date, status, category_id, memo, important)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, title, date::text, end_date::text, status, category_id, memo, important`,
    [
      userId,
      data.title,
      data.date ?? null,
      data.end_date ?? null,
      data.status ?? 'todo',
      data.category_id ?? null,
      data.memo ?? null,
      data.important ?? false,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('createSchedule: INSERT returned no rows');
  return row;
};

const SCHEDULE_COLUMNS = new Set([
  'title',
  'date',
  'end_date',
  'status',
  'category_id',
  'memo',
  'important',
]);

export const updateSchedule = async (
  userId: number,
  id: number,
  data: Partial<{
    title: string;
    date: string | null;
    end_date: string | null;
    status: string;
    category_id: number | null;
    memo: string | null;
    important: boolean;
  }>,
): Promise<ScheduleRow | null> => {
  const fields: string[] = [];
  const values: unknown[] = [userId];
  let idx = 2;

  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined && SCHEDULE_COLUMNS.has(key)) {
      fields.push(`${key} = $${idx}`);
      values.push(value);
      idx++;
    }
  }

  if (fields.length === 0) return queryScheduleById(userId, id);

  values.push(id);
  const result = await query<ScheduleRow>(
    `UPDATE schedules SET ${fields.join(', ')} WHERE user_id = $1 AND id = $${idx}
     RETURNING id, title, date::text, end_date::text, status, category_id, memo, important`,
    values,
  );
  return result.rows[0] ?? null;
};

export const deleteSchedule = async (userId: number, id: number): Promise<boolean> => {
  const result = await query('DELETE FROM schedules WHERE user_id = $1 AND id = $2', [userId, id]);
  return result.rowCount !== null && result.rowCount > 0;
};

// ─── 카테고리 ──────────────────────────────────────────

export const queryCategories = async (userId: number): Promise<CategoryRow[]> =>
  (
    await query<CategoryRow>(
      "SELECT id, name, color, COALESCE(type, 'task') as type, sort_order, parent_id FROM categories WHERE user_id = $1 ORDER BY parent_id NULLS FIRST, sort_order, name",
      [userId],
    )
  ).rows;

export const createCategory = async (
  userId: number,
  data: {
    name: string;
    color?: string;
    type?: string;
    parent_id?: number | null;
  },
): Promise<CategoryRow> => {
  const parentId = data.parent_id ?? null;
  const maxOrder = await queryOne<{ max: number }>(
    parentId
      ? 'SELECT COALESCE(MAX(sort_order), 0) as max FROM categories WHERE user_id = $1 AND parent_id = $2'
      : 'SELECT COALESCE(MAX(sort_order), 0) as max FROM categories WHERE user_id = $1 AND parent_id IS NULL',
    parentId ? [userId, parentId] : [userId],
  );
  const result = await query<CategoryRow>(
    `INSERT INTO categories (user_id, name, color, type, sort_order, parent_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, color, COALESCE(type, 'task') as type, sort_order, parent_id`,
    [
      userId,
      data.name,
      data.color ?? 'gray',
      data.type ?? 'task',
      (maxOrder?.max ?? 0) + 1,
      parentId,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('createCategory: INSERT returned no rows');
  return row;
};

const CATEGORY_COLUMNS = new Set(['name', 'color', 'type', 'sort_order']);

export const updateCategory = async (
  userId: number,
  id: number,
  data: Partial<{ name: string; color: string; type: string; sort_order: number }>,
): Promise<CategoryRow | null> => {
  const fields: string[] = [];
  const values: unknown[] = [userId];
  let idx = 2;

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
    `UPDATE categories SET ${fields.join(', ')} WHERE user_id = $1 AND id = $${idx}
     RETURNING id, name, color, COALESCE(type, 'task') as type, sort_order, parent_id`,
    values,
  );
  return result.rows[0] ?? null;
};

export const deleteCategory = async (userId: number, id: number): Promise<boolean> => {
  const result = await query('DELETE FROM categories WHERE user_id = $1 AND id = $2', [userId, id]);
  return result.rowCount !== null && result.rowCount > 0;
};

/** 카테고리 순서 일괄 업데이트 */
export const reorderCategories = async (
  userId: number,
  orders: { id: number; sort_order: number }[],
): Promise<void> => {
  if (orders.length === 0) return;
  const ids = orders.map((o) => o.id);
  const sortOrders = orders.map((o) => o.sort_order);
  await query(
    `UPDATE categories AS c
     SET sort_order = u.sort_order
     FROM UNNEST($1::int[], $2::int[]) AS u(id, sort_order)
     WHERE c.user_id = $3 AND c.id = u.id`,
    [ids, sortOrders, userId],
  );
};

/** category_id가 해당 user의 categories에 존재하는지 검증 (cross-user FK 차단) */
export const validateCategoryOwnership = async (
  userId: number,
  categoryId: number,
): Promise<boolean> => {
  const row = await queryOne<{ id: number }>(
    'SELECT id FROM categories WHERE user_id = $1 AND id = $2',
    [userId, categoryId],
  );
  return row !== null;
};
