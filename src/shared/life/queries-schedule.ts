/**
 * 일정 쿼리: 타입 · 조회 · 상태 변경.
 */

import { query } from '../db.js';

export interface ScheduleRow {
  id: number;
  title: string;
  date: string | null;
  end_date: string | null;
  status: string;
  category_id: number | null;
  /** 일정에 직접 매핑된 카테고리 이름 (child일 수도 parent일 수도) */
  category_name: string | null;
  /** event/task 분류 — child 우선, 없으면 parent */
  category_type: string | null;
  /** 그룹화용 최상위 카테고리 이름 */
  top_category_name: string | null;
  memo: string | null;
  important: boolean;
}

// ─── 일정 쿼리 ──────────────────────────────────────────

/** 특정 날짜의 일정 조회 (당일 + 기간 일정 포함, categories 계층 JOIN) */
export const queryTodaySchedules = async (today: string, userId: number): Promise<ScheduleRow[]> =>
  (
    await query<ScheduleRow>(
      `SELECT s.id, s.title, s.date::text, s.end_date::text, s.status,
              s.category_id,
              c.name AS category_name,
              COALESCE(c.type, p.type) AS category_type,
              COALESCE(p.name, c.name) AS top_category_name,
              s.memo, s.important
     FROM schedules s
     LEFT JOIN categories c ON c.id = s.category_id
     LEFT JOIN categories p ON p.id = c.parent_id
     WHERE s.status != 'cancelled' AND s.user_id = $1
       AND (s.date = $2 OR (s.date <= $2 AND s.end_date >= $2))
     ORDER BY
       CASE WHEN COALESCE(c.type, p.type) = 'event' THEN 0 ELSE 1 END,
       COALESCE(p.name, c.name) NULLS LAST,
       c.name NULLS LAST,
       s.status, s.title`,
      [userId, today],
    )
  ).rows;

/** 백로그 일정 조회 (날짜 미지정 항목, categories 계층 JOIN) */
export const queryBacklogSchedules = async (userId: number): Promise<ScheduleRow[]> =>
  (
    await query<ScheduleRow>(
      `SELECT s.id, s.title, s.date::text, s.end_date::text, s.status,
              s.category_id,
              c.name AS category_name,
              COALESCE(c.type, p.type) AS category_type,
              COALESCE(p.name, c.name) AS top_category_name,
              s.memo, s.important
     FROM schedules s
     LEFT JOIN categories c ON c.id = s.category_id
     LEFT JOIN categories p ON p.id = c.parent_id
     WHERE s.date IS NULL AND s.status != 'cancelled' AND s.user_id = $1
     ORDER BY COALESCE(p.name, c.name) NULLS LAST,
              c.name NULLS LAST,
              s.important DESC, s.title`,
      [userId],
    )
  ).rows;

/**
 * 밀린 일정(task 타입) 건수.
 * 정식 정의: status='todo' + 과거 날짜(date < today, NULL 제외) + task 타입만.
 * event 타입(약속·여행·정보 등, 완료 대상 아님)은 제외 — 무한 누적 방지.
 * category_type은 child 우선(c.type), 없으면 parent(p.type), 둘 다 없으면 'task'.
 * 아침 잔소리(detectOverdue)와 일정 맥락(queryScheduleContext) 공유 단일 소스.
 */
export const countOverdueTasks = async (today: string, userId: number): Promise<number> => {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM schedules s
       LEFT JOIN categories c ON c.id = s.category_id
       LEFT JOIN categories p ON p.id = c.parent_id
      WHERE s.status = 'todo' AND s.date < $1 AND s.date IS NOT NULL AND s.user_id = $2
        AND COALESCE(c.type, p.type, 'task') = 'task'`,
    [today, userId],
  );
  return Number(result.rows[0]?.count ?? 0);
};

/** 일정을 특정 날짜로 이동 */
export const moveScheduleToDate = async (
  id: number,
  date: string,
  userId: number,
): Promise<void> => {
  await query("UPDATE schedules SET date = $1, status = 'todo' WHERE id = $2 AND user_id = $3", [
    date,
    id,
    userId,
  ]);
};

/** 일정 상태 변경 */
export const updateScheduleStatus = async (
  id: number,
  status: string,
  userId: number,
): Promise<void> => {
  await query('UPDATE schedules SET status = $1 WHERE id = $2 AND user_id = $3', [
    status,
    id,
    userId,
  ]);
};

/** 일정 삭제 */
export const deleteSchedule = async (id: number, userId: number): Promise<void> => {
  await query('DELETE FROM schedules WHERE id = $1 AND user_id = $2', [id, userId]);
};

/** 일정 중요 표시 토글 */
export const toggleScheduleImportant = async (id: number, userId: number): Promise<void> => {
  await query('UPDATE schedules SET important = NOT important WHERE id = $1 AND user_id = $2', [
    id,
    userId,
  ]);
};

/** 일정 내일로 미루기 (date 변경 + status → todo) */
export const postponeSchedule = async (
  id: number,
  newDate: string,
  userId: number,
): Promise<void> => {
  await query("UPDATE schedules SET date = $1, status = 'todo' WHERE id = $2 AND user_id = $3", [
    newDate,
    id,
    userId,
  ]);
};
