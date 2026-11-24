/**
 * 루틴 하락 감지: 주간 회귀 · 산발성 누락.
 */

import { query } from '../db.js';
import { INSIGHT_THRESHOLDS } from '../insight-thresholds.js';
import type { Insight } from './types.js';

// ─── 감지: 주간 루틴 회귀 ───────────────────────────────

interface RegressionRow {
  name: string;
  this_rate: number;
  last_rate: number;
}

export const detectWeeklyRegression = async (
  today: string,
  userId: number,
): Promise<Insight | null> => {
  const { prevWeekMinRate, thisWeekMaxRate } = INSIGHT_THRESHOLDS.weeklyRegression;
  try {
    const result = await query<RegressionRow>(
      `WITH this_week AS (
        SELECT t.id, t.name,
          ROUND(COUNT(*) FILTER (WHERE r.completed)::numeric
            / NULLIF(COUNT(*), 0) * 100)::int AS rate
        FROM routine_records r
        JOIN routine_templates t ON r.template_id = t.id
        WHERE r.user_id = $2 AND t.frequency = '매일'
          AND r.date BETWEEN ($1::date - 6) AND $1
          AND r.date >= t.created_at::date
          AND r.entry_type = 'scheduled'
        GROUP BY t.id, t.name
        HAVING COUNT(*) >= 4
      ),
      last_week AS (
        SELECT t.id,
          ROUND(COUNT(*) FILTER (WHERE r.completed)::numeric
            / NULLIF(COUNT(*), 0) * 100)::int AS rate
        FROM routine_records r
        JOIN routine_templates t ON r.template_id = t.id
        WHERE r.user_id = $2 AND t.frequency = '매일'
          AND r.date BETWEEN ($1::date - 13) AND ($1::date - 7)
          AND r.date >= t.created_at::date
          AND r.entry_type = 'scheduled'
        GROUP BY t.id
        HAVING COUNT(*) >= 4
      )
      SELECT this_week.name, this_week.rate AS this_rate, last_week.rate AS last_rate
      FROM this_week JOIN last_week ON this_week.id = last_week.id
      WHERE last_week.rate >= ${prevWeekMinRate} AND this_week.rate <= ${thisWeekMaxRate}
      ORDER BY (last_week.rate - this_week.rate) DESC LIMIT 1`,
      [today, userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      type: 'weeklyRegression',
      priority: 6,
      timing: 'weekly',
      domain: 'routine',
      message: `지난주 ${row.name} 잘 지켰는데 이번주는 ${row.this_rate}%로 떨어졌네`,
    };
  } catch {
    return null;
  }
};

// ─── 감지: 산발성 누락 ──────────────────────────────────

interface SpottyRow {
  name: string;
  miss_count: number;
  max_consecutive_miss: number;
}

export const detectSpottyPattern = async (
  today: string,
  userId: number,
): Promise<Insight | null> => {
  const { lookbackDays, minMissCount, maxMissCount } = INSIGHT_THRESHOLDS.spottyPattern;
  try {
    const result = await query<SpottyRow>(
      `WITH window_records AS (
        SELECT t.id AS template_id, t.name, r.date, r.completed,
          ROW_NUMBER() OVER (PARTITION BY t.id ORDER BY r.date) AS rn
        FROM routine_records r
        JOIN routine_templates t ON r.template_id = t.id
        WHERE r.user_id = $2 AND t.active = true AND t.frequency = '매일'
          AND r.date BETWEEN ($1::date - ${lookbackDays - 1}) AND $1
          AND r.entry_type = 'scheduled'
      ),
      miss_groups AS (
        SELECT template_id, name, date, completed,
          rn - ROW_NUMBER() OVER (PARTITION BY template_id, completed ORDER BY rn) AS grp
        FROM window_records WHERE completed = false
      ),
      stats AS (
        SELECT m.template_id, m.name,
          (SELECT COUNT(*) FROM window_records w
            WHERE w.template_id = m.template_id AND w.completed = false) AS miss_count,
          MAX(sub.consecutive) AS max_consecutive_miss
        FROM miss_groups m,
          LATERAL (SELECT COUNT(*)::int AS consecutive FROM miss_groups m2
            WHERE m2.template_id = m.template_id AND m2.grp = m.grp) sub
        GROUP BY m.template_id, m.name
      )
      SELECT name, miss_count::int, max_consecutive_miss::int
      FROM stats
      WHERE miss_count BETWEEN ${minMissCount} AND ${maxMissCount}
        AND max_consecutive_miss < miss_count
      ORDER BY miss_count DESC LIMIT 1`,
      [today, userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      type: 'spottyPattern',
      priority: 6,
      timing: 'night',
      domain: 'routine',
      message: `${row.name} 이번주 듬성듬성 빠지고 있어. 7일 중 ${row.miss_count}번`,
    };
  } catch {
    return null;
  }
};
