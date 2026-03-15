/**
 * 프로액티브 인사이트 감지 엔진.
 * 수면/루틴/일정 데이터에서 의미 있는 패턴을 감지하고 넛지 메시지를 생성한다.
 * Pure SQL + 코드 템플릿 기반 (LLM 호출 없음, 비용 0).
 */

import { query } from './db.js';

// ─── 타입 ───────────────────────────────────────────────

export type InsightType = 'streak' | 'sleepTrend' | 'slotGap' | 'weekComparison' | 'overdueAlert';
type InsightTiming = 'morning' | 'night';

export interface Insight {
  type: InsightType;
  priority: number;
  timing: InsightTiming;
  message: string;
}

// ─── 상수 ───────────────────────────────────────────────

/** streak 넛지를 보내는 마일스톤 일수 */
const STREAK_MILESTONES = new Set([3, 5, 7, 10, 14, 21, 30]);

// ─── 감지: 루틴 연속 달성 ────────────────────────────────

interface StreakRow {
  name: string;
  streak: string;
}

export const detectStreak = async (today: string): Promise<Insight | null> => {
  try {
    const result = await query<StreakRow>(
      `WITH daily AS (
        SELECT r.template_id, t.name, r.date, r.completed
        FROM routine_records r
        JOIN routine_templates t ON r.template_id = t.id
        WHERE r.date BETWEEN ($1::date - 30) AND $1
          AND t.active = true AND t.frequency = '매일'
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
      WHERE streak >= 3
      ORDER BY streak DESC LIMIT 1`,
      [today],
    );

    const row = result.rows[0];
    if (!row) return null;

    const streak = Number(row.streak);
    if (!STREAK_MILESTONES.has(streak)) return null;

    return {
      type: 'streak',
      priority: streak * 2,
      timing: 'morning',
      message: `${row.name} ${streak}일 연속 달성 중! 대단하다`,
    };
  } catch {
    return null;
  }
};

// ─── 감지: 수면 트렌드 ──────────────────────────────────

interface SleepTrendRow {
  date: string;
  duration_minutes: number;
}

export const detectSleepTrend = async (today: string): Promise<Insight | null> => {
  try {
    const result = await query<SleepTrendRow>(
      `SELECT date::text, duration_minutes
       FROM sleep_records
       WHERE sleep_type = 'night'
         AND date BETWEEN ($1::date - 3) AND $1
         AND duration_minutes IS NOT NULL
       ORDER BY date DESC
       LIMIT 3`,
      [today],
    );

    if (result.rows.length < 3) return null;

    const durations = result.rows.map((r) => r.duration_minutes);
    const isDecreasing = durations[0] < durations[1] && durations[1] < durations[2];
    const isIncreasing = durations[0] > durations[1] && durations[1] > durations[2];

    if (isDecreasing && durations[0] < 420) {
      return {
        type: 'sleepTrend',
        priority: 8,
        timing: 'night',
        message: '수면 시간이 3일째 줄고 있어. 좀 일찍 자자',
      };
    }

    if (isIncreasing) {
      return {
        type: 'sleepTrend',
        priority: 4,
        timing: 'night',
        message: '수면 시간이 3일째 늘고 있어. 좋은 흐름이야!',
      };
    }

    return null;
  } catch {
    return null;
  }
};

// ─── 감지: 시간대별 루틴 격차 ────────────────────────────

interface SlotRow {
  time_slot: string;
  total: string;
  done: string;
  rate: number;
}

export const detectSlotGap = async (today: string): Promise<Insight | null> => {
  try {
    const result = await query<SlotRow>(
      `SELECT t.time_slot,
        COUNT(*)::text AS total,
        COUNT(*) FILTER (WHERE r.completed)::text AS done,
        ROUND(COUNT(*) FILTER (WHERE r.completed)::numeric
          / NULLIF(COUNT(*), 0) * 100)::int AS rate
       FROM routine_records r
       JOIN routine_templates t ON r.template_id = t.id
       WHERE r.date BETWEEN ($1::date - 6) AND $1
         AND r.date >= t.created_at::date
       GROUP BY t.time_slot
       HAVING COUNT(*) >= 3
       ORDER BY rate`,
      [today],
    );

    if (result.rows.length < 2) return null;

    const best = result.rows[result.rows.length - 1];
    const worst = result.rows[0];
    const gap = best.rate - worst.rate;

    if (gap < 30) return null;

    return {
      type: 'slotGap',
      priority: 5,
      timing: 'night',
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

export const detectWeekComparison = async (today: string): Promise<Insight | null> => {
  try {
    const result = await query<WeekCompRow>(
      `WITH this_week AS (
        SELECT ROUND(COUNT(*) FILTER (WHERE r.completed)::numeric
          / NULLIF(COUNT(*), 0) * 100)::int AS rate
        FROM routine_records r
        JOIN routine_templates t ON r.template_id = t.id
        WHERE r.date BETWEEN ($1::date - 6) AND $1 AND r.date >= t.created_at::date
      ),
      last_week AS (
        SELECT ROUND(COUNT(*) FILTER (WHERE r.completed)::numeric
          / NULLIF(COUNT(*), 0) * 100)::int AS rate
        FROM routine_records r
        JOIN routine_templates t ON r.template_id = t.id
        WHERE r.date BETWEEN ($1::date - 13) AND ($1::date - 7) AND r.date >= t.created_at::date
      )
      SELECT this_week.rate AS this_rate, last_week.rate AS last_rate
      FROM this_week, last_week`,
      [today],
    );

    const row = result.rows[0];
    if (!row || row.this_rate == null || row.last_rate == null) return null;

    const diff = row.this_rate - row.last_rate;
    if (Math.abs(diff) < 5) return null;

    const isPositive = diff > 0;
    return {
      type: 'weekComparison',
      priority: Math.abs(diff) >= 10 ? 6 : 4,
      timing: isPositive ? 'morning' : 'night',
      message: isPositive
        ? `이번 주 루틴 ${row.this_rate}%, 지난주 ${row.last_rate}%에서 올랐어!`
        : `이번 주 루틴 ${row.this_rate}%, 지난주 ${row.last_rate}%에서 떨어졌어. 힘내자`,
    };
  } catch {
    return null;
  }
};

// ─── 감지: 밀린 일정 ────────────────────────────────────

interface OverdueRow {
  overdue_count: number;
}

export const detectOverdue = async (today: string): Promise<Insight | null> => {
  try {
    const result = await query<OverdueRow>(
      `SELECT COUNT(*)::int AS overdue_count
       FROM schedules
       WHERE status = 'todo' AND date < $1 AND date IS NOT NULL`,
      [today],
    );

    const count = result.rows[0]?.overdue_count ?? 0;
    if (count < 3) return null;

    return {
      type: 'overdueAlert',
      priority: 7,
      timing: 'morning',
      message: `밀린 일정이 ${count}건이야. 오늘 하나라도 정리하자`,
    };
  } catch {
    return null;
  }
};

// ─── 통합 감지 + 넛지 선택 ──────────────────────────────

const detectAll = async (today: string): Promise<Insight[]> => {
  const results = await Promise.all([
    detectStreak(today),
    detectSleepTrend(today),
    detectSlotGap(today),
    detectWeekComparison(today),
    detectOverdue(today),
  ]);
  return results.filter((r): r is Insight => r !== null);
};

const pickByTiming = async (today: string, timing: InsightTiming): Promise<string | null> => {
  const all = await detectAll(today);
  const candidates = all.filter((i) => i.timing === timing);
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.priority - a.priority);
  return candidates[0].message;
};

/** 아침 크론용: 아침 타이밍 인사이트 중 최고 우선순위 1개 */
export const pickMorningNudge = (today: string): Promise<string | null> =>
  pickByTiming(today, 'morning');

/** 밤 크론용: 밤 타이밍 인사이트 중 최고 우선순위 1개 */
export const pickNightNudge = (today: string): Promise<string | null> =>
  pickByTiming(today, 'night');
