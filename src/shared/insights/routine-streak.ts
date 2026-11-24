/**
 * 루틴 연속 달성 계열 감지: 연속 달성 · 회복 · 연속 달성 후 첫 누락.
 */

import { query } from '../db.js';
import { INSIGHT_THRESHOLDS } from '../insight-thresholds.js';
import type { Insight } from './types.js';

// ─── 상수 ───────────────────────────────────────────────

const STREAK_MILESTONES = new Set<number>(INSIGHT_THRESHOLDS.streak.milestones);

// ─── 감지: 루틴 연속 달성 ────────────────────────────────

interface StreakRow {
  name: string;
  streak: string;
}

export const detectStreak = async (today: string, userId: number): Promise<Insight | null> => {
  const { lookbackDays, minStreak } = INSIGHT_THRESHOLDS.streak;
  try {
    const result = await query<StreakRow>(
      `WITH daily AS (
        SELECT r.template_id, t.name, r.date, r.completed
        FROM routine_records r
        JOIN routine_templates t ON r.template_id = t.id
        WHERE r.date BETWEEN ($1::date - ${lookbackDays}) AND $1
          AND t.active = true AND t.frequency = '매일'
          AND r.user_id = $2
          AND r.entry_type = 'scheduled'
        ORDER BY r.template_id, r.date DESC
      ),
      streaks AS (
        SELECT template_id, name,
          COUNT(*) FILTER (WHERE grp = 0) AS streak
        FROM (
          SELECT *,
            SUM(CASE WHEN NOT completed THEN 1 ELSE 0 END)
              OVER (PARTITION BY template_id ORDER BY date DESC) AS grp
          FROM daily
        ) sub
        WHERE grp = 0
        GROUP BY template_id, name
      )
      SELECT name, streak::text FROM streaks
      WHERE streak >= ${minStreak}
      ORDER BY streak DESC LIMIT 1`,
      [today, userId],
    );

    const row = result.rows[0];
    if (!row) return null;

    const streak = Number(row.streak);
    if (!STREAK_MILESTONES.has(streak)) return null;

    return {
      type: 'streak',
      priority: streak * 2,
      timing: 'morning',
      domain: 'routine',
      message: `${row.name} ${streak}일 연속 달성 중! 대단하다`,
    };
  } catch {
    return null;
  }
};

// ─── 감지: 루틴 회복 ────────────────────────────────────

interface RecoveryRow {
  name: string;
  break_date: string;
  recovery_gap_days: number;
}

export const detectRecovery = async (today: string, userId: number): Promise<Insight | null> => {
  const { minStreakBeforeBreak, fastRecoveryDays } = INSIGHT_THRESHOLDS.recovery;
  try {
    const result = await query<RecoveryRow>(
      `WITH recent_records AS (
        SELECT t.id AS template_id, t.name, r.date, r.completed
        FROM routine_records r
        JOIN routine_templates t ON r.template_id = t.id
        WHERE r.user_id = $2 AND t.active = true AND t.frequency = '매일'
          AND r.date BETWEEN ($1::date - 30) AND $1
          AND r.entry_type = 'scheduled'
      ),
      break_events AS (
        SELECT template_id, name, date AS break_date,
          (SELECT COUNT(*) FROM recent_records r2
            WHERE r2.template_id = r1.template_id
              AND r2.date < r1.date
              AND r2.completed = true
              AND NOT EXISTS (
                SELECT 1 FROM recent_records r3
                WHERE r3.template_id = r1.template_id
                  AND r3.date BETWEEN r2.date AND (r1.date - INTERVAL '1 day')
                  AND r3.completed = false
              )
          ) AS streak_before
        FROM recent_records r1
        WHERE r1.completed = false
      ),
      next_completion AS (
        SELECT b.template_id, b.name, b.break_date, b.streak_before,
          (SELECT MIN(r.date) FROM recent_records r
            WHERE r.template_id = b.template_id AND r.date > b.break_date AND r.completed = true
          ) AS next_done_date
        FROM break_events b
        WHERE b.streak_before >= ${minStreakBeforeBreak}
      )
      SELECT name, break_date::text,
        (next_done_date - break_date)::int AS recovery_gap_days
      FROM next_completion
      WHERE next_done_date IS NOT NULL
        AND (next_done_date - break_date)::int <= ${fastRecoveryDays}
        AND next_done_date = $1::date
      ORDER BY streak_before DESC LIMIT 1`,
      [today, userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      type: 'recovery',
      priority: 6,
      timing: 'morning',
      domain: 'routine',
      message: `${row.name} 어제 빠졌는데 오늘 바로 다시 시작했네. 회복 속도 좋다`,
    };
  } catch {
    return null;
  }
};

// ─── 감지: 연속 달성 후 첫 누락 ─────────────────────────

interface LapseRow {
  name: string;
}

export const detectLapseAlert = async (today: string, userId: number): Promise<Insight | null> => {
  const { consecutiveDaysBeforeMiss } = INSIGHT_THRESHOLDS.lapseAlert;
  try {
    const result = await query<LapseRow>(
      `WITH today_miss AS (
        SELECT r.template_id, t.name
        FROM routine_records r
        JOIN routine_templates t ON r.template_id = t.id
        WHERE r.user_id = $2 AND t.active = true AND t.frequency = '매일'
          AND r.date = $1 AND r.completed = false
          AND r.entry_type = 'scheduled'
      ),
      prev_streaks AS (
        SELECT tm.template_id, tm.name,
          (SELECT COUNT(*) FROM routine_records r
            WHERE r.template_id = tm.template_id
              AND r.user_id = $2
              AND r.entry_type = 'scheduled'
              AND r.date BETWEEN ($1::date - ${consecutiveDaysBeforeMiss}) AND ($1::date - 1)
              AND r.completed = true) AS prev_done_count
        FROM today_miss tm
      )
      SELECT name FROM prev_streaks
      WHERE prev_done_count >= ${consecutiveDaysBeforeMiss}
      ORDER BY name LIMIT 1`,
      [today, userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      type: 'lapseAlert',
      priority: 7,
      timing: 'night',
      domain: 'routine',
      message: `${row.name} ${consecutiveDaysBeforeMiss}일 연속 잘 지키다가 오늘 빠졌네`,
    };
  } catch {
    return null;
  }
};
