import { query } from '../../shared/db.js';
import { DEFAULT_USER_ID } from '../../shared/user-resolver.js';
import type { WeeklyRoutineData } from './types.js';

// ─── 집계: 루틴 ─────────────────────────────────────────

interface RoutineRateRow {
  this_week_total: number;
  this_week_done: number;
  this_week_rate: number | null;
  last_week_rate: number | null;
}

interface SlotBreakdownRow {
  slot: string;
  rate: number;
}

interface RoutineNameRow {
  name: string;
  rate: number;
}

export const aggregateWeeklyRoutine = async (
  weekStart: string,
  weekEnd: string,
  userId: number = DEFAULT_USER_ID,
): Promise<WeeklyRoutineData> => {
  const empty: WeeklyRoutineData = {
    thisWeekRate: 0,
    thisWeekCompleted: 0,
    thisWeekTotal: 0,
    lastWeekRate: null,
    slotBreakdown: [],
    bestRoutine: null,
    worstRoutine: null,
  };

  try {
    // 이번주 달성률 + 지난주 비교 (각 루틴의 created_at 이후 기록만 집계)
    const rateResult = await query<RoutineRateRow>(
      `WITH this_week AS (
        SELECT
          COUNT(*)::int AS this_week_total,
          COUNT(*) FILTER (WHERE r.completed)::int AS this_week_done,
          ROUND(COUNT(*) FILTER (WHERE r.completed)::numeric
            / NULLIF(COUNT(*), 0) * 100)::int AS this_week_rate
        FROM routine_records r
        JOIN routine_templates t ON r.template_id = t.id
        WHERE r.date BETWEEN $1 AND $2 AND r.date >= t.created_at::date AND r.user_id = $3
          AND r.entry_type = 'scheduled'
      ),
      last_week AS (
        SELECT ROUND(COUNT(*) FILTER (WHERE r.completed)::numeric
          / NULLIF(COUNT(*), 0) * 100)::int AS last_week_rate
        FROM routine_records r
        JOIN routine_templates t ON r.template_id = t.id
        WHERE r.date BETWEEN ($1::date - 7) AND ($1::date - 1) AND r.date >= t.created_at::date AND r.user_id = $3
          AND r.entry_type = 'scheduled'
      )
      SELECT this_week_total, this_week_done, this_week_rate, last_week_rate
      FROM this_week, last_week`,
      [weekStart, weekEnd, userId],
    );

    const rate = rateResult.rows[0];
    if (!rate || rate.this_week_total === 0) return empty;

    // 시간대별 달성률 (각 루틴의 created_at 이후 기록만 집계)
    const slotResult = await query<SlotBreakdownRow>(
      `SELECT t.time_slot AS slot,
        ROUND(COUNT(*) FILTER (WHERE r.completed)::numeric
          / NULLIF(COUNT(*), 0) * 100)::int AS rate
      FROM routine_records r
      JOIN routine_templates t ON r.template_id = t.id
      WHERE r.date BETWEEN $1 AND $2 AND r.date >= t.created_at::date AND r.user_id = $3
        AND r.entry_type = 'scheduled'
      GROUP BY t.time_slot
      ORDER BY rate DESC`,
      [weekStart, weekEnd, userId],
    );

    // 루틴별 달성률 (best/worst) — 주간 시작일 이전에 생성된 루틴만 포함
    const routineResult = await query<RoutineNameRow>(
      `SELECT t.name,
        ROUND(COUNT(*) FILTER (WHERE r.completed)::numeric
          / NULLIF(COUNT(*), 0) * 100)::int AS rate
      FROM routine_records r
      JOIN routine_templates t ON r.template_id = t.id
      WHERE r.date BETWEEN $1 AND $2
        AND t.created_at::date < $1::date
        AND r.user_id = $3
        AND r.entry_type = 'scheduled'
      GROUP BY t.id, t.name
      HAVING COUNT(*) >= 2
      ORDER BY rate DESC`,
      [weekStart, weekEnd, userId],
    );

    const routines = routineResult.rows;

    return {
      thisWeekRate: rate.this_week_rate ?? 0,
      thisWeekCompleted: rate.this_week_done,
      thisWeekTotal: rate.this_week_total,
      lastWeekRate: rate.last_week_rate,
      slotBreakdown: slotResult.rows.map((r) => ({ slot: r.slot, rate: r.rate })),
      bestRoutine: routines.length > 0 ? { name: routines[0].name, rate: routines[0].rate } : null,
      worstRoutine:
        routines.length > 1
          ? { name: routines[routines.length - 1].name, rate: routines[routines.length - 1].rate }
          : null,
    };
  } catch {
    return empty;
  }
};
