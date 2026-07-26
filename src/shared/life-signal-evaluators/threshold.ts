/**
 * threshold evaluator — 임계치 풀셋 (수면 / 루틴 streak).
 *
 * source='sleep_minutes':       해당 날짜의 sleep_records 수면 분 (wake_at - sleep_at)
 * source='routine_streak_max':  해당 날짜 시점의 active 루틴 중 최대 streak (연속 완료일)
 *
 * 데이터 없으면 false (예: 수면 기록 누락한 날은 'sleep_le_7'도 false).
 * 마스터 #434 ADR-0028 — 풀셋 임계치 철학 sleep/streak로 확장.
 */

import { query } from '../db.js';
import type { DailyContext, ThresholdAux } from '../pattern-match.js';

interface SleepMinutesRow {
  minutes: string;
}

interface StreakMaxRow {
  max_streak: string;
}

const loadSleepMinutes = async (userId: number, date: string): Promise<number | null> => {
  // 분할 수면 정합: 세그먼트 1건(LIMIT 1)이 아니라 그 날짜 수면 분을 합산.
  // 세그먼트 하나만 집으면 분할일이 실제보다 짧게 잡혀 임계치(≤6/7/8h)를 잘못 트리거한다.
  const result = await query<SleepMinutesRow>(
    `SELECT SUM(duration_minutes)::text AS minutes
       FROM sleep_records
      WHERE user_id = $1 AND date = $2 AND duration_minutes IS NOT NULL`,
    [userId, date],
  );
  const row = result.rows[0];
  if (!row || row.minutes === null) return null;
  const n = Number(row.minutes);
  return Number.isFinite(n) ? n : null;
};

const loadRoutineStreakMax = async (userId: number, date: string): Promise<number> => {
  // 해당 날짜 시점에 active 루틴들의 streak 최대값.
  // streak = 오늘부터 거꾸로 보면서 첫 미완료 직전까지의 연속 완료일.
  const result = await query<StreakMaxRow>(
    `WITH daily AS (
       SELECT r.template_id, r.date, r.completed
         FROM routine_records r
         JOIN routine_templates t ON r.template_id = t.id
        WHERE r.date BETWEEN ($2::date - 60) AND $2
          AND t.active = true AND r.user_id = $1
          AND r.entry_type = 'scheduled'
     ),
     streaks AS (
       SELECT template_id, COUNT(*) FILTER (WHERE grp = 0) AS streak
         FROM (
           SELECT *,
                  SUM(CASE WHEN NOT completed THEN 1 ELSE 0 END)
                    OVER (PARTITION BY template_id ORDER BY date DESC) AS grp
             FROM daily
         ) sub
        WHERE grp = 0
        GROUP BY template_id
     )
     SELECT COALESCE(MAX(streak), 0)::text AS max_streak FROM streaks`,
    [userId, date],
  );
  const row = result.rows[0];
  return row ? Number(row.max_streak) : 0;
};

export const evaluateThreshold = async (aux: ThresholdAux, ctx: DailyContext): Promise<boolean> => {
  let actualValue: number | null = null;

  switch (aux.source) {
    case 'sleep_minutes':
      actualValue = await loadSleepMinutes(ctx.userId, ctx.date);
      break;
    case 'routine_streak_max':
      actualValue = await loadRoutineStreakMax(ctx.userId, ctx.date);
      break;
  }

  if (actualValue === null) return false;

  switch (aux.op) {
    case 'lte':
      return actualValue <= aux.value;
    case 'gte':
      return actualValue >= aux.value;
    case 'eq':
      return actualValue === aux.value;
  }
};
