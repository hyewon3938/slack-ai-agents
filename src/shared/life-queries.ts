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
  start_date: string;
}

export interface RoutineRecordRow {
  id: number;
  template_id: number;
  date: string;
  completed: boolean;
  completed_at: string | null;
  memo: string | null;
  name: string; // JOIN routine_templates
  time_slot: string; // JOIN
  frequency: string; // JOIN
}

export interface ScheduleRow {
  id: number;
  title: string;
  date: string | null;
  end_date: string | null;
  status: string;
  category: string | null;
  category_type: string | null;
  memo: string | null;
  important: boolean;
}

export interface SleepRecordRow {
  id: number;
  date: string;
  bedtime: string | null;
  wake_time: string | null;
  duration_minutes: number | null;
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

/** 빈도에서 간격 일수 추출 (예: '3일마다' → 3, '격일' → 2, '주1회' → 7) */
const parseIntervalDays = (frequency: string): number | null => {
  if (frequency === '격일') return 2;
  if (frequency === '주1회') return 7;
  const match = /^(\d+)일마다$/.exec(frequency);
  return match ? Number(match[1]) : null;
};

/** 빈도에 따라 오늘 기록을 생성해야 하는지 판별 */
export const shouldCreateToday = (
  frequency: string,
  lastDate: string | null,
  today: string,
  startDate?: string,
): boolean => {
  if (frequency === '매일') return true;

  // 간격 빈도(격일, N일마다): start_date 기준 모듈러 연산
  const intervalDays = parseIntervalDays(frequency);
  if (intervalDays && startDate) {
    const gap = daysBetween(startDate, today);
    return gap >= 0 && gap % intervalDays === 0;
  }

  // startDate 없는 경우 (폴백): gap 기반
  if (!lastDate) return true;
  const gap = daysBetween(lastDate, today);
  if (intervalDays) return gap >= intervalDays;

  return true;
};

/** 빈도 → 표시용 배지 텍스트 (매일은 빈 문자열) */
export const frequencyBadge = (frequency: string): string => {
  if (frequency === '주1회') return '_(1주 마다)_';
  const intervalDays = parseIntervalDays(frequency);
  if (intervalDays) return `_(${intervalDays}일 마다)_`;
  return '';
};

// ─── 루틴 쿼리 ──────────────────────────────────────────

/** 활성 루틴 템플릿 전체 조회 */
export const queryActiveTemplates = async (): Promise<RoutineTemplateRow[]> =>
  (
    await query<RoutineTemplateRow>(
      'SELECT id, name, time_slot, frequency, start_date::text FROM routine_templates WHERE active = true AND user_id = 1 ORDER BY id',
    )
  ).rows;

/** 특정 날짜의 루틴 기록 조회 (템플릿 JOIN) */
export const queryTodayRecords = async (today: string): Promise<RoutineRecordRow[]> =>
  (
    await query<RoutineRecordRow>(
      `SELECT r.id, r.template_id, r.date::text, r.completed, r.completed_at::text, r.memo,
            t.name, t.time_slot, t.frequency
     FROM routine_records r
     JOIN routine_templates t ON r.template_id = t.id
     WHERE r.date = $1 AND r.user_id = 1
     ORDER BY
       CASE t.time_slot
         WHEN '낮' THEN 1 WHEN '밤' THEN 2
       END, t.name`,
      [today],
    )
  ).rows;

/** 특정 날짜에 이미 생성된 기록의 template_id 집합 */
export const queryExistingTemplateIds = async (today: string): Promise<Set<number>> => {
  const rows = (
    await query<{ template_id: number }>(
      'SELECT template_id FROM routine_records WHERE date = $1 AND user_id = 1',
      [today],
    )
  ).rows;
  return new Set(rows.map((r) => r.template_id));
};

/** 특정 템플릿의 가장 최근 기록 날짜 */
export const queryLastRecordDate = async (templateId: number): Promise<string | null> => {
  const result = await query<{ date: string }>(
    'SELECT date::text FROM routine_records WHERE template_id = $1 AND user_id = 1 ORDER BY date DESC LIMIT 1',
    [templateId],
  );
  return result.rows[0]?.date ?? null;
};

/** 루틴 기록 생성 */
export const createRecord = async (templateId: number, today: string): Promise<number> => {
  const result = await query<{ id: number }>(
    'INSERT INTO routine_records (template_id, date, completed, user_id) VALUES ($1, $2, false, 1) RETURNING id',
    [templateId, today],
  );
  const row = result.rows[0];
  if (!row) throw new Error('createRecord: INSERT returned no rows');
  return row.id;
};

/** 루틴 완료 처리 (완료 시점 기록) */
export const completeRecord = async (id: number): Promise<void> => {
  await query('UPDATE routine_records SET completed = true, completed_at = NOW() WHERE id = $1 AND user_id = 1', [
    id,
  ]);
};

// ─── 일정 쿼리 ──────────────────────────────────────────

/** 특정 날짜의 일정 조회 (당일 + 기간 일정 포함, categories JOIN) */
export const queryTodaySchedules = async (today: string): Promise<ScheduleRow[]> =>
  (
    await query<ScheduleRow>(
      `SELECT s.id, s.title, s.date::text, s.end_date::text, s.status,
              s.category, c.type AS category_type, s.memo, s.important
     FROM schedules s
     LEFT JOIN categories c ON c.name = s.category
     WHERE s.status != 'cancelled' AND s.user_id = 1
       AND (s.date = $1 OR (s.date <= $1 AND s.end_date >= $1))
     ORDER BY
       CASE WHEN c.type = 'event' THEN 0 ELSE 1 END,
       s.category NULLS LAST, s.status, s.title`,
      [today],
    )
  ).rows;

/** 백로그 일정 조회 (날짜 미지정 항목, categories JOIN) */
export const queryBacklogSchedules = async (): Promise<ScheduleRow[]> =>
  (
    await query<ScheduleRow>(
      `SELECT s.id, s.title, s.date::text, s.end_date::text, s.status,
              s.category, c.type AS category_type, s.memo, s.important
     FROM schedules s
     LEFT JOIN categories c ON c.name = s.category
     WHERE s.date IS NULL AND s.status != 'cancelled' AND s.user_id = 1
     ORDER BY s.category NULLS LAST, s.important DESC, s.title`,
    )
  ).rows;

/** 일정을 특정 날짜로 이동 */
export const moveScheduleToDate = async (id: number, date: string): Promise<void> => {
  await query("UPDATE schedules SET date = $1, status = 'todo' WHERE id = $2 AND user_id = 1", [date, id]);
};

/** 일정 상태 변경 */
export const updateScheduleStatus = async (id: number, status: string): Promise<void> => {
  await query('UPDATE schedules SET status = $1 WHERE id = $2 AND user_id = 1', [status, id]);
};

/** 일정 삭제 */
export const deleteSchedule = async (id: number): Promise<void> => {
  await query('DELETE FROM schedules WHERE id = $1 AND user_id = 1', [id]);
};

/** 일정 중요 표시 토글 */
export const toggleScheduleImportant = async (id: number): Promise<void> => {
  await query('UPDATE schedules SET important = NOT important WHERE id = $1 AND user_id = 1', [id]);
};

/** 일정 내일로 미루기 (date 변경 + status → todo) */
export const postponeSchedule = async (id: number, newDate: string): Promise<void> => {
  await query("UPDATE schedules SET date = $1, status = 'todo' WHERE id = $2 AND user_id = 1", [newDate, id]);
};

// ─── 수면 쿼리 ──────────────────────────────────────

/** 어젯밤 수면 기록 존재 확인 (date = 기상일 기준 단일 날짜) */
export const queryNightSleepExists = async (wakeDate: string): Promise<boolean> => {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*)::text as count FROM sleep_records
     WHERE sleep_type = 'night' AND date = $1 AND user_id = 1`,
    [wakeDate],
  );
  return Number(result.rows[0]?.count ?? 0) > 0;
};

// ─── 알림 설정 쿼리 ──────────────────────────────────

export interface NotificationSettingRow {
  id: number;
  slot_name: string;
  label: string;
  time_value: string;
  active: boolean;
}

/** 알림 설정 전체 조회 */
export const queryNotificationSettings = async (): Promise<NotificationSettingRow[]> =>
  (
    await query<NotificationSettingRow>(
      'SELECT id, slot_name, label, time_value, active FROM notification_settings ORDER BY id',
    )
  ).rows;

// ─── 리마인더 쿼리 ──────────────────────────────────

export interface ReminderRow {
  id: number;
  title: string;
  time_value: string;
  date: string | null;
  frequency: string | null;
  active: boolean;
  end_date: string | null;
  remaining_count: number | null;
}

/** 현재 시각에 발동할 리마인더 조회 */
export const queryDueReminders = async (
  today: string,
  currentTime: string,
  dow: number,
): Promise<ReminderRow[]> =>
  (
    await query<ReminderRow>(
      `SELECT id, title, time_value, date::text, frequency, active,
              end_date::text, remaining_count
     FROM reminders
     WHERE active = true
       AND time_value = $1
       AND (end_date IS NULL OR $2::date <= end_date)
       AND (
         (date = $2)
         OR (date IS NULL AND frequency = '매일')
         OR (date IS NULL AND frequency = '평일' AND $3 BETWEEN 1 AND 5)
         OR (date IS NULL AND frequency = '주말' AND $3 IN (0, 6))
         OR (date IS NULL AND frequency = '매주'
             AND $3 = ANY(days_of_week)
             AND (($2::date - COALESCE(reference_date, $2::date)) / 7)
                 % COALESCE(repeat_interval, 1) = 0)
         OR (date IS NULL AND frequency = '매월'
             AND EXTRACT(DAY FROM $2::date)::int = ANY(days_of_month)
             AND ((EXTRACT(YEAR FROM $2::date)::int * 12
                   + EXTRACT(MONTH FROM $2::date)::int)
                  - (EXTRACT(YEAR FROM COALESCE(reference_date, $2::date))::int * 12
                     + EXTRACT(MONTH FROM COALESCE(reference_date, $2::date))::int))
                 % COALESCE(repeat_interval, 1) = 0)
         OR (date IS NULL AND frequency = '며칠마다'
             AND $2::date >= COALESCE(reference_date, $2::date)
             AND (($2::date - COALESCE(reference_date, $2::date))::int)
                 % COALESCE(repeat_interval, 1) = 0)
       )`,
      [currentTime, today, dow],
    )
  ).rows;

/** 활성 리마인더의 고유 time_value 목록 조회 (캐시용) */
export const queryActiveReminderTimes = async (): Promise<Set<string>> => {
  const result = await query<{ time_value: string }>(
    'SELECT DISTINCT time_value FROM reminders WHERE active = true',
  );
  return new Set(result.rows.map((r) => r.time_value));
};

/** 리마인더 비활성화 (일회성 발동 후) */
export const deactivateReminder = async (id: number): Promise<void> => {
  await query('UPDATE reminders SET active = false WHERE id = $1', [id]);
};

/** remaining_count 차감. 0이 되면 자동 비활성화. 비활성화 여부 반환. */
export const decrementReminderCount = async (id: number): Promise<boolean> => {
  const result = await query<{ remaining_count: number }>(
    `UPDATE reminders
     SET remaining_count = remaining_count - 1
     WHERE id = $1 AND remaining_count IS NOT NULL AND remaining_count > 0
     RETURNING remaining_count`,
    [id],
  );
  if (result.rows.length > 0 && result.rows[0].remaining_count === 0) {
    await deactivateReminder(id);
    return true;
  }
  return false;
};

export interface SleepEventRow {
  id: number;
  date: string;
  event_time: string;
  memo: string | null;
}

// ─── 수면 쿼리 (Home 탭) ────────────────────────────

/** Home 탭용 수면 기록 조회: 오늘 날짜 밤잠 + 낮잠 (effective date 기준) */
export const querySleepForHome = async (today: string): Promise<SleepRecordRow[]> => {
  const result = await query<SleepRecordRow>(
    `(SELECT id, date::text, bedtime, wake_time, duration_minutes, sleep_type, memo
      FROM sleep_records
      WHERE sleep_type = 'night' AND date = $1 AND user_id = 1
      ORDER BY date DESC LIMIT 1)
     UNION ALL
     (SELECT id, date::text, bedtime, wake_time, duration_minutes, sleep_type, memo
      FROM sleep_records
      WHERE sleep_type = 'nap' AND date = $1 AND user_id = 1
      ORDER BY bedtime)`,
    [today],
  );
  return result.rows;
};

/** Home 탭용 수면 중간 기상 이벤트 조회 */
export const querySleepEventsForHome = async (today: string): Promise<SleepEventRow[]> =>
  (
    await query<SleepEventRow>(
      `SELECT id, date::text, event_time, memo FROM sleep_events
     WHERE date = $1 ORDER BY event_time`,
      [today],
    )
  ).rows;
