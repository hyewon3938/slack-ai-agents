/**
 * 수면 감지: 수면 트렌드 · 수면 드리프트.
 */

import { query } from '../db.js';
import { INSIGHT_THRESHOLDS } from '../insight-thresholds.js';
import type { Insight } from './types.js';

// ─── 감지: 수면 트렌드 ──────────────────────────────────

interface SleepTrendRow {
  date: string;
  duration_minutes: number;
}

export const detectSleepTrend = async (today: string, userId: number): Promise<Insight | null> => {
  const { windowDays, shortSleepMinutes } = INSIGHT_THRESHOLDS.sleepTrend;
  try {
    const result = await query<SleepTrendRow>(
      `SELECT date::text, SUM(duration_minutes)::int AS duration_minutes
       FROM sleep_records
       WHERE sleep_type = 'night'
         AND date BETWEEN ($1::date - ${windowDays}) AND $1
         AND duration_minutes IS NOT NULL
         AND user_id = $2
       GROUP BY date
       ORDER BY date DESC
       LIMIT ${windowDays}`,
      [today, userId],
    );

    if (result.rows.length < windowDays) return null;

    const durations = result.rows.map((r) => r.duration_minutes);
    const isDecreasing = durations[0] < durations[1] && durations[1] < durations[2];
    const isIncreasing = durations[0] > durations[1] && durations[1] > durations[2];

    if (isDecreasing && durations[0] < shortSleepMinutes) {
      return {
        type: 'sleepTrend',
        priority: 8,
        timing: 'night',
        domain: 'sleep',
        message: '수면 시간이 3일째 줄고 있어. 좀 일찍 자자',
      };
    }

    if (isIncreasing) {
      return {
        type: 'sleepTrend',
        priority: 4,
        timing: 'night',
        domain: 'sleep',
        message: '수면 시간이 3일째 늘고 있어. 좋은 흐름이야!',
      };
    }

    return null;
  } catch {
    return null;
  }
};

// ─── 감지: 수면 드리프트 ────────────────────────────────

interface DriftRow {
  this_week_avg_bedtime_minutes: number | null;
  prev_weeks_avg_bedtime_minutes: number | null;
  this_week_avg_wake_minutes: number | null;
  prev_weeks_avg_wake_minutes: number | null;
  this_week_mid_wake: number;
  prev_weeks_mid_wake_per_week: number;
  this_week_nights: number;
}

export const detectDrift = async (today: string, userId: number): Promise<Insight | null> => {
  const {
    windowWeeks,
    bedtimeShiftMinutes,
    wakeShiftMinutes,
    midWakeIncreaseRatio,
    minSampleNights,
  } = INSIGHT_THRESHOLDS.drift;
  try {
    // 분할 수면 정합: 날짜별로 취침=첫 세그먼트 onset(20:00 래핑 최솟값), 기상=마지막 세그먼트(MAX),
    // duration=세그먼트 합산. 세그먼트 행 단위 평균이면 분할일이 이중 가중되고 2번째 세그먼트 취침이 섞인다.
    const result = await query<DriftRow>(
      `WITH this_week_daily AS (
        SELECT date,
          MIN(CASE WHEN bedtime::time >= '20:00'
                THEN EXTRACT(EPOCH FROM bedtime::time) / 60 - 1440
                ELSE EXTRACT(EPOCH FROM bedtime::time) / 60 END) AS bedtime_minutes,
          MAX(EXTRACT(EPOCH FROM wake_time::time) / 60) AS wake_minutes,
          SUM(duration_minutes) AS duration_minutes
        FROM sleep_records
        WHERE user_id = $2 AND sleep_type = 'night'
          AND date BETWEEN ($1::date - 6) AND $1
        GROUP BY date
      ),
      prev_weeks_daily AS (
        SELECT date,
          MIN(CASE WHEN bedtime::time >= '20:00'
                THEN EXTRACT(EPOCH FROM bedtime::time) / 60 - 1440
                ELSE EXTRACT(EPOCH FROM bedtime::time) / 60 END) AS bedtime_minutes,
          MAX(EXTRACT(EPOCH FROM wake_time::time) / 60) AS wake_minutes,
          SUM(duration_minutes) AS duration_minutes
        FROM sleep_records
        WHERE user_id = $2 AND sleep_type = 'night'
          AND date BETWEEN ($1::date - ${windowWeeks * 7 - 1}) AND ($1::date - 7)
        GROUP BY date
      ),
      this_week_events AS (
        SELECT COUNT(*)::int AS cnt FROM sleep_events
        WHERE date BETWEEN ($1::date - 6) AND $1
      ),
      prev_weeks_events AS (
        SELECT COUNT(*)::int AS cnt FROM sleep_events
        WHERE date BETWEEN ($1::date - ${windowWeeks * 7 - 1}) AND ($1::date - 7)
      )
      SELECT
        (SELECT AVG(bedtime_minutes) FROM this_week_daily WHERE bedtime_minutes IS NOT NULL) AS this_week_avg_bedtime_minutes,
        (SELECT AVG(bedtime_minutes) FROM prev_weeks_daily WHERE bedtime_minutes IS NOT NULL) AS prev_weeks_avg_bedtime_minutes,
        (SELECT AVG(wake_minutes) FROM this_week_daily WHERE wake_minutes IS NOT NULL) AS this_week_avg_wake_minutes,
        (SELECT AVG(wake_minutes) FROM prev_weeks_daily WHERE wake_minutes IS NOT NULL) AS prev_weeks_avg_wake_minutes,
        (SELECT cnt FROM this_week_events) AS this_week_mid_wake,
        (SELECT cnt::numeric / ${windowWeeks} FROM prev_weeks_events) AS prev_weeks_mid_wake_per_week,
        (SELECT COUNT(*)::int FROM this_week_daily WHERE duration_minutes IS NOT NULL) AS this_week_nights`,
      [today, userId],
    );
    const row = result.rows[0];
    if (!row || row.this_week_nights < minSampleNights) return null;

    const messages: string[] = [];

    if (
      row.this_week_avg_bedtime_minutes != null &&
      row.prev_weeks_avg_bedtime_minutes != null &&
      row.this_week_avg_bedtime_minutes - row.prev_weeks_avg_bedtime_minutes >= bedtimeShiftMinutes
    ) {
      const diff = Math.round(
        row.this_week_avg_bedtime_minutes - row.prev_weeks_avg_bedtime_minutes,
      );
      messages.push(`취침 시간이 ${windowWeeks}주 평균보다 ${diff}분 늦어졌어`);
    }

    if (
      row.this_week_avg_wake_minutes != null &&
      row.prev_weeks_avg_wake_minutes != null &&
      row.this_week_avg_wake_minutes - row.prev_weeks_avg_wake_minutes >= wakeShiftMinutes
    ) {
      const diff = Math.round(row.this_week_avg_wake_minutes - row.prev_weeks_avg_wake_minutes);
      messages.push(`기상 시간이 ${windowWeeks}주 평균보다 ${diff}분 늦어졌어`);
    }

    if (
      row.prev_weeks_mid_wake_per_week > 0 &&
      row.this_week_mid_wake >= row.prev_weeks_mid_wake_per_week * midWakeIncreaseRatio
    ) {
      messages.push(`이번주 중간기상 ${row.this_week_mid_wake}회. 평소보다 잦아`);
    }

    if (messages.length === 0) return null;
    return {
      type: 'drift',
      priority: 6,
      timing: 'weekly',
      domain: 'sleep',
      message: messages[0],
    };
  } catch {
    return null;
  }
};
