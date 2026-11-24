/**
 * 루틴 완료율 비교 감지: 시간대별 격차 · 주간 비교.
 */

import { query } from '../db.js';
import { INSIGHT_THRESHOLDS } from '../insight-thresholds.js';
import type { Insight } from './types.js';

// ─── 감지: 시간대별 루틴 격차 ────────────────────────────

interface SlotRow {
  time_slot: string;
  total: string;
  done: string;
  rate: number;
}

export const detectSlotGap = async (today: string, userId: number): Promise<Insight | null> => {
  const { minGap, minSampleSize, lookbackDays } = INSIGHT_THRESHOLDS.slotGap;
  try {
    const result = await query<SlotRow>(
      `SELECT t.time_slot,
        COUNT(*)::text AS total,
        COUNT(*) FILTER (WHERE r.completed)::text AS done,
        ROUND(COUNT(*) FILTER (WHERE r.completed)::numeric
          / NULLIF(COUNT(*), 0) * 100)::int AS rate
       FROM routine_records r
       JOIN routine_templates t ON r.template_id = t.id
       WHERE r.date BETWEEN ($1::date - ${lookbackDays - 1}) AND $1
         AND r.date >= t.created_at::date
         AND r.user_id = $2
         AND r.entry_type = 'scheduled'
       GROUP BY t.time_slot
       HAVING COUNT(*) >= ${minSampleSize}
       ORDER BY rate`,
      [today, userId],
    );

    if (result.rows.length < 2) return null;

    const best = result.rows[result.rows.length - 1];
    const worst = result.rows[0];
    const gap = best.rate - worst.rate;

    if (gap < minGap) return null;

    return {
      type: 'slotGap',
      priority: 5,
      timing: 'night',
      domain: 'routine',
      message: `${best.time_slot} 루틴은 ${best.rate}%인데 ${worst.time_slot} 루틴이 ${worst.rate}%야`,
    };
  } catch {
    return null;
  }
};

// ─── 감지: 주간 비교 ────────────────────────────────────

interface WeekCompRow {
  this_rate: number | null;
  last_rate: number | null;
}

export const detectWeekComparison = async (
  today: string,
  userId: number,
): Promise<Insight | null> => {
  const { significantDiff, largeDiff } = INSIGHT_THRESHOLDS.weekComparison;
  try {
    const result = await query<WeekCompRow>(
      `WITH this_week AS (
        SELECT ROUND(COUNT(*) FILTER (WHERE r.completed)::numeric
          / NULLIF(COUNT(*), 0) * 100)::int AS rate
        FROM routine_records r
        JOIN routine_templates t ON r.template_id = t.id
        WHERE r.date BETWEEN ($1::date - 6) AND $1 AND r.date >= t.created_at::date AND r.user_id = $2
          AND r.entry_type = 'scheduled'
      ),
      last_week AS (
        SELECT ROUND(COUNT(*) FILTER (WHERE r.completed)::numeric
          / NULLIF(COUNT(*), 0) * 100)::int AS rate
        FROM routine_records r
        JOIN routine_templates t ON r.template_id = t.id
        WHERE r.date BETWEEN ($1::date - 13) AND ($1::date - 7) AND r.date >= t.created_at::date AND r.user_id = $2
          AND r.entry_type = 'scheduled'
      )
      SELECT this_week.rate AS this_rate, last_week.rate AS last_rate
      FROM this_week, last_week`,
      [today, userId],
    );

    const row = result.rows[0];
    if (!row || row.this_rate == null || row.last_rate == null) return null;

    const diff = row.this_rate - row.last_rate;
    if (Math.abs(diff) < significantDiff) return null;

    const isPositive = diff > 0;
    return {
      type: 'weekComparison',
      priority: Math.abs(diff) >= largeDiff ? 6 : 4,
      timing: isPositive ? 'morning' : 'night',
      domain: 'routine',
      message: isPositive
        ? `이번 주 루틴 ${row.this_rate}%, 지난주 ${row.last_rate}%에서 올랐어!`
        : `이번 주 루틴 ${row.this_rate}%, 지난주 ${row.last_rate}%에서 떨어졌어. 힘내자`,
    };
  } catch {
    return null;
  }
};
