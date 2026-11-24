import { query } from '../../shared/db.js';
import { DEFAULT_USER_ID } from '../../shared/user-resolver.js';
import type { SleepRoutineCorrelation } from './types.js';

// ─── 집계: 수면 × 루틴 상관관계 ─────────────────────────

interface CorrelationRow {
  good_sleep_rate: number | null;
  bad_sleep_rate: number | null;
}

export const aggregateSleepRoutineCorrelation = async (
  weekStart: string,
  weekEnd: string,
  userId: number = DEFAULT_USER_ID,
): Promise<SleepRoutineCorrelation> => {
  try {
    const result = await query<CorrelationRow>(
      `WITH daily_sleep AS (
        SELECT date, SUM(duration_minutes) AS duration_minutes
        FROM sleep_records
        WHERE sleep_type = 'night'
          AND date BETWEEN $1 AND $2
          AND duration_minutes IS NOT NULL
          AND user_id = $3
        GROUP BY date
      ),
      daily_routine AS (
        SELECT r.date,
          ROUND(COUNT(*) FILTER (WHERE r.completed)::numeric
            / NULLIF(COUNT(*), 0) * 100)::int AS rate
        FROM routine_records r
        JOIN routine_templates t ON r.template_id = t.id
        WHERE r.date BETWEEN $1 AND $2 AND r.date >= t.created_at::date AND r.user_id = $3
          AND r.entry_type = 'scheduled'
        GROUP BY r.date
      )
      SELECT
        (SELECT ROUND(AVG(r.rate))::int FROM daily_routine r
          JOIN daily_sleep s ON r.date = s.date
          WHERE s.duration_minutes >= 420) AS good_sleep_rate,
        (SELECT ROUND(AVG(r.rate))::int FROM daily_routine r
          JOIN daily_sleep s ON r.date = s.date
          WHERE s.duration_minutes < 360) AS bad_sleep_rate`,
      [weekStart, weekEnd, userId],
    );

    const row = result.rows[0];
    return {
      goodSleepRate: row?.good_sleep_rate ?? null,
      badSleepRate: row?.bad_sleep_rate ?? null,
    };
  } catch {
    return { goodSleepRate: null, badSleepRate: null };
  }
};
