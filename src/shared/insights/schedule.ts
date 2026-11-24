/**
 * 일정 감지: 밀린 일정 · 카테고리 편향.
 */

import { query } from '../db.js';
import { INSIGHT_THRESHOLDS } from '../insight-thresholds.js';
import { countOverdueTasks } from '../life/queries-schedule.js';
import type { Insight } from './types.js';

// ─── 감지: 밀린 일정 ────────────────────────────────────

export const detectOverdue = async (today: string, userId: number): Promise<Insight | null> => {
  const { minCount } = INSIGHT_THRESHOLDS.overdueAlert;
  try {
    const count = await countOverdueTasks(today, userId);
    if (count < minCount) return null;

    return {
      type: 'overdueAlert',
      priority: 7,
      timing: 'morning',
      domain: 'schedule',
      message: `밀린 일정이 ${count}건이야. 오늘 하나라도 정리하자`,
    };
  } catch {
    return null;
  }
};

// ─── 감지: 카테고리 편향 ────────────────────────────────

interface CategorySkewRow {
  category_name: string;
  count: number;
  total: number;
}

export const detectCategorySkew = async (
  today: string,
  userId: number,
  timing: 'night' | 'weekly' = 'night',
): Promise<Insight | null> => {
  const { lookbackDays, minTotalSchedules, dominantRatio } = INSIGHT_THRESHOLDS.categorySkew;
  try {
    const result = await query<CategorySkewRow>(
      `WITH window_schedules AS (
        SELECT s.id, COALESCE(p.name, c.name, '미분류') AS top_category
        FROM schedules s
        LEFT JOIN categories c ON c.id = s.category_id
        LEFT JOIN categories p ON p.id = c.parent_id
        WHERE s.user_id = $2
          AND s.date BETWEEN ($1::date - ${lookbackDays - 1}) AND $1
          AND s.status != 'cancelled'
          AND COALESCE(c.type, p.type, 'task') = 'task'
      )
      SELECT top_category AS category_name,
             COUNT(*)::int AS count,
             (SELECT COUNT(*) FROM window_schedules)::int AS total
      FROM window_schedules
      GROUP BY top_category
      ORDER BY count DESC
      LIMIT 1`,
      [today, userId],
    );
    const row = result.rows[0];
    if (!row || row.total < minTotalSchedules) return null;
    const ratio = row.count / row.total;
    if (ratio < dominantRatio) return null;
    return {
      type: 'categorySkew',
      priority: 5,
      timing,
      domain: 'schedule',
      message:
        timing === 'weekly'
          ? `지난주 ${row.category_name} 위주의 일정이었네`
          : `최근 며칠 ${row.category_name} 위주의 일정이네`,
    };
  } catch {
    return null;
  }
};
