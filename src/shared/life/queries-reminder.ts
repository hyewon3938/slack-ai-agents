/**
 * 리마인더 쿼리.
 */

import { query } from '../db.js';

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
