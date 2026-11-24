/**
 * 수면 쿼리 (Home 탭): 타입 · 조회.
 */

import { query } from '../db.js';

export interface SleepRecordRow {
  id: number;
  date: string;
  bedtime: string | null;
  wake_time: string | null;
  duration_minutes: number | null;
  sleep_type: string;
  memo: string | null;
}

export interface SleepEventRow {
  id: number;
  date: string;
  event_time: string;
  memo: string | null;
}

// ─── 수면 쿼리 (Home 탭) ────────────────────────────

/**
 * Home 탭용 수면 기록 조회: 오늘 날짜 밤잠 + 낮잠 (effective date 기준).
 * 밤잠은 분할 수면 세그먼트를 모두 반환한다 (LIMIT 1로 자르지 않음).
 * 렌더러(buildSleepBlocks)가 여러 세그먼트 + 총합을 표시한다.
 */
export const querySleepForHome = async (
  today: string,
  userId: number,
): Promise<SleepRecordRow[]> => {
  const result = await query<SleepRecordRow>(
    `(SELECT id, date::text, bedtime, wake_time, duration_minutes, sleep_type, memo
      FROM sleep_records
      WHERE sleep_type = 'night' AND date = $1 AND user_id = $2
      ORDER BY bedtime)
     UNION ALL
     (SELECT id, date::text, bedtime, wake_time, duration_minutes, sleep_type, memo
      FROM sleep_records
      WHERE sleep_type = 'nap' AND date = $1 AND user_id = $2
      ORDER BY bedtime)`,
    [today, userId],
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
