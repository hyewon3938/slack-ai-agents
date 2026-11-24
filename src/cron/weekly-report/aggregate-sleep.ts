import { query } from '../../shared/db.js';
import { DEFAULT_USER_ID } from '../../shared/user-resolver.js';
import type { WeeklySleepData } from './types.js';

// ─── 집계: 수면 ─────────────────────────────────────────

interface SleepAggRow {
  avg_duration: number | null;
  record_count: number;
  best_date: string | null;
  best_duration: number | null;
  worst_date: string | null;
  worst_duration: number | null;
}

export const aggregateWeeklySleep = async (
  weekStart: string,
  weekEnd: string,
  userId: number = DEFAULT_USER_ID,
): Promise<WeeklySleepData> => {
  try {
    // 분할 수면 정합: 세그먼트가 아니라 날짜별 합산을 1 레코드로 집계 (평균·최고·최저·건수 왜곡 방지)
    const result = await query<SleepAggRow>(
      `WITH daily AS (
        SELECT date::text AS date, SUM(duration_minutes)::int AS duration_minutes
        FROM sleep_records
        WHERE sleep_type = 'night'
          AND date BETWEEN $1 AND $2
          AND duration_minutes IS NOT NULL
          AND user_id = $3
        GROUP BY date
      )
      SELECT
        ROUND(AVG(duration_minutes))::int AS avg_duration,
        COUNT(*)::int AS record_count,
        (SELECT date FROM daily ORDER BY duration_minutes DESC LIMIT 1) AS best_date,
        (SELECT duration_minutes FROM daily ORDER BY duration_minutes DESC LIMIT 1) AS best_duration,
        (SELECT date FROM daily ORDER BY duration_minutes ASC LIMIT 1) AS worst_date,
        (SELECT duration_minutes FROM daily ORDER BY duration_minutes ASC LIMIT 1) AS worst_duration
      FROM daily`,
      [weekStart, weekEnd, userId],
    );

    const row = result.rows[0];
    if (!row || row.record_count === 0) {
      return { avgDuration: 0, recordCount: 0, bestDay: null, worstDay: null };
    }

    return {
      avgDuration: row.avg_duration ?? 0,
      recordCount: row.record_count,
      bestDay: row.best_date ? { date: row.best_date, duration: row.best_duration ?? 0 } : null,
      worstDay: row.worst_date ? { date: row.worst_date, duration: row.worst_duration ?? 0 } : null,
    };
  } catch {
    return { avgDuration: 0, recordCount: 0, bestDay: null, worstDay: null };
  }
};
