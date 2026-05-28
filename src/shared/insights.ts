/**
 * 프로액티브 인사이트 감지 엔진.
 * 수면/루틴/일정 데이터에서 의미 있는 패턴을 감지하고 넛지 메시지를 생성한다.
 * Pure SQL + 코드 템플릿 기반 (LLM 호출 없음, 비용 0).
 */

import { query } from './db.js';
import { INSIGHT_THRESHOLDS } from './insight-thresholds.js';

// ─── 타입 ───────────────────────────────────────────────

export type InsightType =
  | 'streak'
  | 'sleepTrend'
  | 'slotGap'
  | 'weekComparison'
  | 'overdueAlert'
  | 'categorySkew'
  | 'drift'
  | 'recovery'
  | 'lapseAlert'
  | 'weeklyRegression'
  | 'spottyPattern';

export type InsightTiming = 'morning' | 'night' | 'weekly';

export type InsightDomain = 'routine' | 'sleep' | 'schedule';

export interface Insight {
  type: InsightType;
  priority: number;
  timing: InsightTiming;
  domain: InsightDomain;
  message: string;
}

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

// ─── 감지: 수면 트렌드 ──────────────────────────────────

interface SleepTrendRow {
  date: string;
  duration_minutes: number;
}

export const detectSleepTrend = async (today: string, userId: number): Promise<Insight | null> => {
  const { windowDays, shortSleepMinutes } = INSIGHT_THRESHOLDS.sleepTrend;
  try {
    const result = await query<SleepTrendRow>(
      `SELECT date::text, duration_minutes
       FROM sleep_records
       WHERE sleep_type = 'night'
         AND date BETWEEN ($1::date - ${windowDays}) AND $1
         AND duration_minutes IS NOT NULL
         AND user_id = $2
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
      ),
      last_week AS (
        SELECT ROUND(COUNT(*) FILTER (WHERE r.completed)::numeric
          / NULLIF(COUNT(*), 0) * 100)::int AS rate
        FROM routine_records r
        JOIN routine_templates t ON r.template_id = t.id
        WHERE r.date BETWEEN ($1::date - 13) AND ($1::date - 7) AND r.date >= t.created_at::date AND r.user_id = $2
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

// ─── 감지: 밀린 일정 ────────────────────────────────────

interface OverdueRow {
  overdue_count: number;
}

export const detectOverdue = async (today: string, userId: number): Promise<Insight | null> => {
  const { minCount } = INSIGHT_THRESHOLDS.overdueAlert;
  try {
    const result = await query<OverdueRow>(
      `SELECT COUNT(*)::int AS overdue_count
       FROM schedules
       WHERE status = 'todo' AND date < $1 AND date IS NOT NULL AND user_id = $2`,
      [today, userId],
    );

    const count = result.rows[0]?.overdue_count ?? 0;
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
    const result = await query<DriftRow>(
      `WITH this_week_sleep AS (
        SELECT
          CASE WHEN bedtime::time < '06:00'
            THEN (EXTRACT(HOUR FROM bedtime::time) + 24) * 60 + EXTRACT(MINUTE FROM bedtime::time)
            ELSE EXTRACT(HOUR FROM bedtime::time) * 60 + EXTRACT(MINUTE FROM bedtime::time)
          END AS bedtime_minutes,
          EXTRACT(HOUR FROM wake_time::time) * 60 + EXTRACT(MINUTE FROM wake_time::time) AS wake_minutes,
          duration_minutes
        FROM sleep_records
        WHERE user_id = $2 AND sleep_type = 'night'
          AND date BETWEEN ($1::date - 6) AND $1
      ),
      prev_weeks_sleep AS (
        SELECT
          CASE WHEN bedtime::time < '06:00'
            THEN (EXTRACT(HOUR FROM bedtime::time) + 24) * 60 + EXTRACT(MINUTE FROM bedtime::time)
            ELSE EXTRACT(HOUR FROM bedtime::time) * 60 + EXTRACT(MINUTE FROM bedtime::time)
          END AS bedtime_minutes,
          EXTRACT(HOUR FROM wake_time::time) * 60 + EXTRACT(MINUTE FROM wake_time::time) AS wake_minutes,
          duration_minutes
        FROM sleep_records
        WHERE user_id = $2 AND sleep_type = 'night'
          AND date BETWEEN ($1::date - ${windowWeeks * 7 - 1}) AND ($1::date - 7)
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
        (SELECT AVG(bedtime_minutes) FROM this_week_sleep WHERE bedtime_minutes IS NOT NULL) AS this_week_avg_bedtime_minutes,
        (SELECT AVG(bedtime_minutes) FROM prev_weeks_sleep WHERE bedtime_minutes IS NOT NULL) AS prev_weeks_avg_bedtime_minutes,
        (SELECT AVG(wake_minutes) FROM this_week_sleep WHERE wake_minutes IS NOT NULL) AS this_week_avg_wake_minutes,
        (SELECT AVG(wake_minutes) FROM prev_weeks_sleep WHERE wake_minutes IS NOT NULL) AS prev_weeks_avg_wake_minutes,
        (SELECT cnt FROM this_week_events) AS this_week_mid_wake,
        (SELECT cnt::numeric / ${windowWeeks} FROM prev_weeks_events) AS prev_weeks_mid_wake_per_week,
        (SELECT COUNT(*)::int FROM this_week_sleep WHERE duration_minutes IS NOT NULL) AS this_week_nights`,
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
      ),
      prev_streaks AS (
        SELECT tm.template_id, tm.name,
          (SELECT COUNT(*) FROM routine_records r
            WHERE r.template_id = tm.template_id
              AND r.user_id = $2
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

// ─── 통합 감지 + 넛지 선택 ──────────────────────────────

const detectAllForTiming = async (
  today: string,
  userId: number,
  timing: InsightTiming,
): Promise<Insight[]> => {
  const morning = timing === 'morning';
  const weekly = timing === 'weekly';

  const tasks: Array<Promise<Insight | null>> = [
    detectStreak(today, userId),
    detectSleepTrend(today, userId),
    detectSlotGap(today, userId),
    detectWeekComparison(today, userId),
    detectOverdue(today, userId),
  ];

  if (!morning) tasks.push(detectCategorySkew(today, userId, weekly ? 'weekly' : 'night'));
  if (weekly) tasks.push(detectDrift(today, userId));
  if (morning) tasks.push(detectRecovery(today, userId));
  if (!morning && !weekly) tasks.push(detectLapseAlert(today, userId));
  if (weekly) tasks.push(detectWeeklyRegression(today, userId));
  if (!morning && !weekly) tasks.push(detectSpottyPattern(today, userId));

  const results = await Promise.all(tasks);
  return results.filter((r): r is Insight => r !== null && r.timing === timing);
};

const pickByTiming = async (
  today: string,
  userId: number,
  timing: InsightTiming,
): Promise<Insight[]> => {
  const { minPriority, maxItems } = INSIGHT_THRESHOLDS.pickByTiming;
  const all = await detectAllForTiming(today, userId, timing);

  const filtered = all.filter((i) => i.priority >= minPriority);
  filtered.sort((a, b) => b.priority - a.priority);

  const seen = new Set<InsightDomain>();
  const deduped: Insight[] = [];
  for (const insight of filtered) {
    if (seen.has(insight.domain)) continue;
    seen.add(insight.domain);
    deduped.push(insight);
    if (deduped.length >= maxItems) break;
  }

  return deduped;
};

/** 아침 크론용: priority ≥5인 morning 인사이트, 같은 도메인 dedupe, 최대 3개 */
export const pickMorningNudges = (today: string, userId: number): Promise<Insight[]> =>
  pickByTiming(today, userId, 'morning');

/** 밤 크론용: priority ≥5인 night 인사이트, 같은 도메인 dedupe, 최대 3개 */
export const pickNightNudges = (today: string, userId: number): Promise<Insight[]> =>
  pickByTiming(today, userId, 'night');

/** 주간 리포트용: weekly 인사이트 (도메인 dedupe + cap 동일) */
export const pickWeeklyInsights = (today: string, userId: number): Promise<Insight[]> =>
  pickByTiming(today, userId, 'weekly');

// ─── ADR-0019 Phase 4: confirmed 가설 → 일일 잔소리 합류 ───

interface ConfirmedHypothesisRow {
  enum_target: string;
  signal_name: string;
  rate_ratio: string | null;
}

/**
 * 오늘 trigger가 발현한 confirmed 가설들의 잔소리 라인 반환.
 * - confirmed 가설(pattern_hypotheses.status='confirmed') × 오늘 pattern_matches.trigger_activated=true 조인
 * - 가설별 최신 rate_ratio를 같이 보여줘 효과 크기 인지
 * - 빈 결과면 빈 배열 반환 → daily-pattern-matching 측에서 분기
 */
export const pickConfirmedHypothesisLines = async (
  userId: number,
  today: string,
): Promise<string[]> => {
  try {
    const res = await query<ConfirmedHypothesisRow>(
      `SELECT
         h.enum_target,
         c.name AS signal_name,
         (
           SELECT s.rate_ratio::TEXT
             FROM pattern_stats s
            WHERE s.hypothesis_id = h.id
            ORDER BY s.week_start DESC LIMIT 1
         ) AS rate_ratio
       FROM pattern_hypotheses h
       JOIN pattern_catalog c ON c.id = (h.trigger_spec->>'signalId')::INTEGER
       JOIN pattern_matches m
         ON m.user_id = h.user_id
        AND m.pattern_id = c.id
        AND m.date = $2
        AND m.trigger_activated = true
       WHERE h.user_id = $1 AND h.status = 'confirmed'
       ORDER BY c.name`,
      [userId, today],
    );
    return res.rows.map((row) => {
      const ratio = Number(row.rate_ratio);
      const ratioPart = Number.isFinite(ratio) ? ` (평균 ${ratio.toFixed(1)}x)` : '';
      return `*${row.signal_name}* 패턴 켜졌어 → \`${row.enum_target}\` 주의${ratioPart}.`;
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Insights] confirmed 가설 라인 조회 실패: ${msg}`);
    return [];
  }
};
