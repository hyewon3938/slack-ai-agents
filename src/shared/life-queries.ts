/**
 * v2 Life Agent SQL 쿼리 레이어.
 * Notion SDK 의존성 없이 PostgreSQL 직접 조회.
 * 크론(life-cron)과 액션 핸들러(actions)에서 사용.
 */

import { query } from './db.js';

// ─── 타입 ───────────────────────────────────────────────

export interface RoutineTemplateRow {
  id: number;
  name: string;
  time_slot: string;
  frequency: string;
}

export interface RoutineRecordRow {
  id: number;
  template_id: number;
  date: string;
  completed: boolean;
  name: string;       // JOIN routine_templates
  time_slot: string;   // JOIN
  frequency: string;   // JOIN
}

export interface ScheduleRow {
  id: number;
  title: string;
  date: string | null;
  end_date: string | null;
  status: string;
  category: string | null;
  memo: string | null;
  important: boolean;
}

export interface SleepRecordRow {
  id: number;
  date: string;
  bedtime: string;
  wake_time: string;
  duration_minutes: number;
  sleep_type: string;
  memo: string | null;
}

// ─── 빈도 헬퍼 ─────────────────────────────────────────

/** 두 날짜 사이의 일수 (YYYY-MM-DD) */
const daysBetween = (from: string, to: string): number => {
  const msPerDay = 86_400_000;
  const fromDate = new Date(from + 'T00:00:00+09:00');
  const toDate = new Date(to + 'T00:00:00+09:00');
  return Math.round((toDate.getTime() - fromDate.getTime()) / msPerDay);
};

/** 빈도에 따라 오늘 기록을 생성해야 하는지 판별 */
export const shouldCreateToday = (
  frequency: string,
  lastDate: string | null,
  today: string,
): boolean => {
  if (frequency === '매일') return true;
  if (!lastDate) return true;

  const gap = daysBetween(lastDate, today);

  switch (frequency) {
    case '격일':
      return gap >= 2;
    case '3일마다':
      return gap >= 3;
    case '주1회':
      return gap >= 7;
    default:
      return true;
  }
};

/** 빈도 → 표시용 배지 텍스트 (매일은 빈 문자열) */
export const frequencyBadge = (frequency: string): string => {
  switch (frequency) {
    case '격일':
      return '_(2일 마다)_';
    case '3일마다':
      return '_(3일 마다)_';
    case '주1회':
      return '_(1주 마다)_';
    default:
      return '';
  }
};

// ─── 루틴 쿼리 ──────────────────────────────────────────

/** 활성 루틴 템플릿 전체 조회 */
export const queryActiveTemplates = async (): Promise<RoutineTemplateRow[]> =>
  (await query<RoutineTemplateRow>(
    'SELECT id, name, time_slot, frequency FROM routine_templates WHERE active = true ORDER BY id',
  )).rows;

/** 특정 날짜의 루틴 기록 조회 (템플릿 JOIN) */
export const queryTodayRecords = async (today: string): Promise<RoutineRecordRow[]> =>
  (await query<RoutineRecordRow>(
    `SELECT r.id, r.template_id, r.date::text, r.completed,
            t.name, t.time_slot, t.frequency
     FROM routine_records r
     JOIN routine_templates t ON r.template_id = t.id
     WHERE r.date = $1
     ORDER BY
       CASE t.time_slot
         WHEN '아침' THEN 1 WHEN '점심' THEN 2
         WHEN '저녁' THEN 3 WHEN '밤' THEN 4
       END, t.name`,
    [today],
  )).rows;

/** 특정 날짜에 이미 생성된 기록의 template_id 집합 */
export const queryExistingTemplateIds = async (today: string): Promise<Set<number>> => {
  const rows = (await query<{ template_id: number }>(
    'SELECT template_id FROM routine_records WHERE date = $1',
    [today],
  )).rows;
  return new Set(rows.map((r) => r.template_id));
};

/** 특정 템플릿의 가장 최근 기록 날짜 */
export const queryLastRecordDate = async (templateId: number): Promise<string | null> => {
  const result = await query<{ date: string }>(
    'SELECT date::text FROM routine_records WHERE template_id = $1 ORDER BY date DESC LIMIT 1',
    [templateId],
  );
  return result.rows[0]?.date ?? null;
};

/** 루틴 기록 생성 */
export const createRecord = async (templateId: number, today: string): Promise<number> => {
  const result = await query<{ id: number }>(
    'INSERT INTO routine_records (template_id, date, completed) VALUES ($1, $2, false) RETURNING id',
    [templateId, today],
  );
  return result.rows[0]!.id;
};

/** 루틴 완료 처리 */
export const completeRecord = async (id: number): Promise<void> => {
  await query('UPDATE routine_records SET completed = true WHERE id = $1', [id]);
};

// ─── 일정 쿼리 ──────────────────────────────────────────

/** 특정 날짜의 일정 조회 (당일 + 기간 일정 포함) */
export const queryTodaySchedules = async (today: string): Promise<ScheduleRow[]> =>
  (await query<ScheduleRow>(
    `SELECT id, title, date::text, end_date::text, status, category, memo, important
     FROM schedules
     WHERE status != 'cancelled'
       AND (date = $1 OR (date <= $1 AND end_date >= $1))
     ORDER BY category NULLS LAST, status, title`,
    [today],
  )).rows;

/** 일정 상태 변경 */
export const updateScheduleStatus = async (id: number, status: string): Promise<void> => {
  await query('UPDATE schedules SET status = $1 WHERE id = $2', [status, id]);
};

/** 일정 내일로 미루기 (date 변경 + status → todo) */
export const postponeSchedule = async (id: number, newDate: string): Promise<void> => {
  await query(
    "UPDATE schedules SET date = $1, status = 'todo' WHERE id = $2",
    [newDate, id],
  );
};

// ─── 수면 쿼리 ──────────────────────────────────────

/** Home 탭용 수면 기록 조회: 밤잠 최신 1건 + 오늘 낮잠 전부 */
export const querySleepForHome = async (today: string): Promise<SleepRecordRow[]> => {
  const result = await query<SleepRecordRow>(
    `(SELECT id, date::text, bedtime, wake_time, duration_minutes, sleep_type, memo
      FROM sleep_records
      WHERE sleep_type = 'night'
      ORDER BY date DESC LIMIT 1)
     UNION ALL
     (SELECT id, date::text, bedtime, wake_time, duration_minutes, sleep_type, memo
      FROM sleep_records
      WHERE sleep_type = 'nap' AND date = $1
      ORDER BY bedtime)`,
    [today],
  );
  return result.rows;
};
