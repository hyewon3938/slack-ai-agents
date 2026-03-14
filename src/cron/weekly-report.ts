/**
 * 주간 리포트.
 * 매주 일요일 실행: SQL 집계 → Block Kit + Gemini Flash 한줄 총평.
 * 일요일 아닌 날은 early return.
 */

import type { App } from '@slack/bolt';
import type { LifeCronConfig } from './life-cron.js';
import type { LLMMessage } from '../shared/llm.js';
import { query } from '../shared/db.js';
import { getTodayISO, getKSTDayOfWeek, addDays, formatDateShort } from '../shared/kst.js';
import { postBlockMessage } from '../shared/slack.js';
import { CHARACTER_PROMPT } from '../shared/personality.js';

// ─── 타입 ───────────────────────────────────────────────

export interface WeeklySleepData {
  avgDuration: number;
  recordCount: number;
  bestDay: { date: string; duration: number } | null;
  worstDay: { date: string; duration: number } | null;
}

export interface WeeklyRoutineData {
  thisWeekRate: number;
  thisWeekCompleted: number;
  thisWeekTotal: number;
  lastWeekRate: number | null;
  slotBreakdown: { slot: string; rate: number }[];
  bestRoutine: { name: string; rate: number } | null;
  worstRoutine: { name: string; rate: number } | null;
}

export interface WeeklyScheduleData {
  completedCount: number;
  incompleteCount: number;
  cancelledCount: number;
  categories: { category: string; count: number }[];
  overdueCount: number;
}

export interface SleepRoutineCorrelation {
  goodSleepRate: number | null;
  badSleepRate: number | null;
}

export interface WeeklyReportData {
  sleep: WeeklySleepData;
  routine: WeeklyRoutineData;
  schedule: WeeklyScheduleData;
  correlation: SleepRoutineCorrelation;
  weekStart: string;
  weekEnd: string;
}

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
): Promise<WeeklySleepData> => {
  try {
    const result = await query<SleepAggRow>(
      `WITH sleep AS (
        SELECT date::text, duration_minutes
        FROM sleep_records
        WHERE sleep_type = 'night'
          AND date BETWEEN $1 AND $2
          AND duration_minutes IS NOT NULL
      )
      SELECT
        ROUND(AVG(duration_minutes))::int AS avg_duration,
        COUNT(*)::int AS record_count,
        (SELECT date FROM sleep ORDER BY duration_minutes DESC LIMIT 1) AS best_date,
        (SELECT duration_minutes FROM sleep ORDER BY duration_minutes DESC LIMIT 1) AS best_duration,
        (SELECT date FROM sleep ORDER BY duration_minutes ASC LIMIT 1) AS worst_date,
        (SELECT duration_minutes FROM sleep ORDER BY duration_minutes ASC LIMIT 1) AS worst_duration
      FROM sleep`,
      [weekStart, weekEnd],
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
): Promise<WeeklyRoutineData> => {
  const empty: WeeklyRoutineData = {
    thisWeekRate: 0, thisWeekCompleted: 0, thisWeekTotal: 0,
    lastWeekRate: null, slotBreakdown: [], bestRoutine: null, worstRoutine: null,
  };

  try {
    // 이번주 달성률 + 지난주 비교
    const rateResult = await query<RoutineRateRow>(
      `WITH this_week AS (
        SELECT
          COUNT(*)::int AS this_week_total,
          COUNT(*) FILTER (WHERE completed)::int AS this_week_done,
          ROUND(COUNT(*) FILTER (WHERE completed)::numeric
            / NULLIF(COUNT(*), 0) * 100)::int AS this_week_rate
        FROM routine_records WHERE date BETWEEN $1 AND $2
      ),
      last_week AS (
        SELECT ROUND(COUNT(*) FILTER (WHERE completed)::numeric
          / NULLIF(COUNT(*), 0) * 100)::int AS last_week_rate
        FROM routine_records WHERE date BETWEEN ($1::date - 7) AND ($1::date - 1)
      )
      SELECT this_week_total, this_week_done, this_week_rate, last_week_rate
      FROM this_week, last_week`,
      [weekStart, weekEnd],
    );

    const rate = rateResult.rows[0];
    if (!rate || rate.this_week_total === 0) return empty;

    // 시간대별 달성률
    const slotResult = await query<SlotBreakdownRow>(
      `SELECT t.time_slot AS slot,
        ROUND(COUNT(*) FILTER (WHERE r.completed)::numeric
          / NULLIF(COUNT(*), 0) * 100)::int AS rate
      FROM routine_records r
      JOIN routine_templates t ON r.template_id = t.id
      WHERE r.date BETWEEN $1 AND $2
      GROUP BY t.time_slot
      ORDER BY rate DESC`,
      [weekStart, weekEnd],
    );

    // 루틴별 달성률 (best/worst)
    const routineResult = await query<RoutineNameRow>(
      `SELECT t.name,
        ROUND(COUNT(*) FILTER (WHERE r.completed)::numeric
          / NULLIF(COUNT(*), 0) * 100)::int AS rate
      FROM routine_records r
      JOIN routine_templates t ON r.template_id = t.id
      WHERE r.date BETWEEN $1 AND $2
      GROUP BY t.id, t.name
      HAVING COUNT(*) >= 2
      ORDER BY rate DESC`,
      [weekStart, weekEnd],
    );

    const routines = routineResult.rows;

    return {
      thisWeekRate: rate.this_week_rate ?? 0,
      thisWeekCompleted: rate.this_week_done,
      thisWeekTotal: rate.this_week_total,
      lastWeekRate: rate.last_week_rate,
      slotBreakdown: slotResult.rows.map((r) => ({ slot: r.slot, rate: r.rate })),
      bestRoutine: routines.length > 0 ? { name: routines[0].name, rate: routines[0].rate } : null,
      worstRoutine: routines.length > 1
        ? { name: routines[routines.length - 1].name, rate: routines[routines.length - 1].rate }
        : null,
    };
  } catch {
    return empty;
  }
};

// ─── 집계: 일정 ─────────────────────────────────────────

interface ScheduleSummaryRow {
  completed_count: number;
  incomplete_count: number;
  cancelled_count: number;
}

interface CategoryRow {
  category: string;
  count: number;
}

interface OverdueRow {
  overdue_count: number;
}

export const aggregateWeeklySchedule = async (
  weekStart: string,
  weekEnd: string,
): Promise<WeeklyScheduleData> => {
  const empty: WeeklyScheduleData = {
    completedCount: 0, incompleteCount: 0, cancelledCount: 0,
    categories: [], overdueCount: 0,
  };

  try {
    const summaryResult = await query<ScheduleSummaryRow>(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'done')::int AS completed_count,
        COUNT(*) FILTER (WHERE status IN ('todo', 'in-progress'))::int AS incomplete_count,
        COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_count
      FROM schedules
      WHERE date BETWEEN $1 AND $2`,
      [weekStart, weekEnd],
    );

    const summary = summaryResult.rows[0] ?? empty;

    const catResult = await query<CategoryRow>(
      `SELECT COALESCE(category, '미분류') AS category, COUNT(*)::int AS count
      FROM schedules
      WHERE date BETWEEN $1 AND $2
      GROUP BY category
      ORDER BY count DESC`,
      [weekStart, weekEnd],
    );

    const overdueResult = await query<OverdueRow>(
      `SELECT COUNT(*)::int AS overdue_count
      FROM schedules
      WHERE status = 'todo' AND date < $1 AND date IS NOT NULL`,
      [weekEnd],
    );

    return {
      completedCount: summary.completed_count ?? 0,
      incompleteCount: summary.incomplete_count ?? 0,
      cancelledCount: summary.cancelled_count ?? 0,
      categories: catResult.rows.map((r) => ({ category: r.category, count: r.count })),
      overdueCount: overdueResult.rows[0]?.overdue_count ?? 0,
    };
  } catch {
    return empty;
  }
};

// ─── 집계: 수면 × 루틴 상관관계 ─────────────────────────

interface CorrelationRow {
  good_sleep_rate: number | null;
  bad_sleep_rate: number | null;
}

export const aggregateSleepRoutineCorrelation = async (
  weekStart: string,
  weekEnd: string,
): Promise<SleepRoutineCorrelation> => {
  try {
    const result = await query<CorrelationRow>(
      `WITH daily_sleep AS (
        SELECT date, duration_minutes
        FROM sleep_records
        WHERE sleep_type = 'night'
          AND date BETWEEN $1 AND $2
          AND duration_minutes IS NOT NULL
      ),
      daily_routine AS (
        SELECT date,
          ROUND(COUNT(*) FILTER (WHERE completed)::numeric
            / NULLIF(COUNT(*), 0) * 100)::int AS rate
        FROM routine_records
        WHERE date BETWEEN $1 AND $2
        GROUP BY date
      )
      SELECT
        (SELECT ROUND(AVG(r.rate))::int FROM daily_routine r
          JOIN daily_sleep s ON r.date = s.date
          WHERE s.duration_minutes >= 420) AS good_sleep_rate,
        (SELECT ROUND(AVG(r.rate))::int FROM daily_routine r
          JOIN daily_sleep s ON r.date = s.date
          WHERE s.duration_minutes < 360) AS bad_sleep_rate`,
      [weekStart, weekEnd],
    );

    const row = result.rows[0];
    return {
      goodSleepRate: row?.good_sleep_rate ?? null,
      badSleepRate: row?.bad_sleep_rate ?? null,
    };
  } catch {
    return { goodSleepRate: null, badSleepRate: null };
  }
};

// ─── 통합 집계 ──────────────────────────────────────────

export const aggregateWeeklyReport = async (
  weekStart: string,
  weekEnd: string,
): Promise<WeeklyReportData> => {
  const [sleep, routine, schedule, correlation] = await Promise.all([
    aggregateWeeklySleep(weekStart, weekEnd),
    aggregateWeeklyRoutine(weekStart, weekEnd),
    aggregateWeeklySchedule(weekStart, weekEnd),
    aggregateSleepRoutineCorrelation(weekStart, weekEnd),
  ]);

  return { sleep, routine, schedule, correlation, weekStart, weekEnd };
};

// ─── Block Kit 빌드 ─────────────────────────────────────

import type { KnownBlock } from '@slack/types';

/** 분 → "N시간 M분" 포맷 */
const formatDuration = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
};

/** 주간 리포트 Block Kit 빌드 */
const buildWeeklyReportBlocks = (
  data: WeeklyReportData,
  summary: string,
): KnownBlock[] => {
  const { sleep, routine, schedule, correlation, weekStart, weekEnd } = data;
  const blocks: KnownBlock[] = [];

  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: `📊 주간 리포트 (${formatDateShort(weekStart)} ~ ${formatDateShort(weekEnd)})`,
      emoji: true,
    },
  });

  // ── 수면 ──
  blocks.push({ type: 'divider' });
  if (sleep.recordCount < 2) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*수면*\n데이터 부족 (2건 미만)' } });
  } else {
    const lines = [`*수면*`, `평균 ${formatDuration(sleep.avgDuration)} (${sleep.recordCount}일 기록)`];
    if (sleep.bestDay && sleep.worstDay && sleep.bestDay.date !== sleep.worstDay.date) {
      lines.push(
        `가장 잘 잔 날: ${formatDateShort(sleep.bestDay.date)} ${formatDuration(sleep.bestDay.duration)} | 가장 못 잔 날: ${formatDateShort(sleep.worstDay.date)} ${formatDuration(sleep.worstDay.duration)}`,
      );
    }
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } });
  }

  // ── 루틴 ──
  blocks.push({ type: 'divider' });
  if (routine.thisWeekTotal < 2) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*루틴*\n데이터 부족 (2건 미만)' } });
  } else {
    const lastPart = routine.lastWeekRate != null ? ` — 지난주 ${routine.lastWeekRate}%` : '';
    const lines = [
      `*루틴*`,
      `주간 달성률: ${routine.thisWeekRate}% (${routine.thisWeekCompleted}/${routine.thisWeekTotal})${lastPart}`,
    ];
    if (routine.slotBreakdown.length > 0) {
      lines.push(`시간대별: ${routine.slotBreakdown.map((s) => `${s.slot} ${s.rate}%`).join(', ')}`);
    }
    if (routine.bestRoutine) {
      const worstPart = routine.worstRoutine ? ` | 최저: ${routine.worstRoutine.name} ${routine.worstRoutine.rate}%` : '';
      lines.push(`최고: ${routine.bestRoutine.name} ${routine.bestRoutine.rate}%${worstPart}`);
    }
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } });
  }

  // ── 일정 ──
  blocks.push({ type: 'divider' });
  const total = schedule.completedCount + schedule.incompleteCount + schedule.cancelledCount;
  if (total < 2) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*일정*\n데이터 부족 (2건 미만)' } });
  } else {
    const lines = [
      `*일정*`,
      `완료 ${schedule.completedCount}건 / 미완료 ${schedule.incompleteCount}건 / 취소 ${schedule.cancelledCount}건`,
    ];
    if (schedule.categories.length > 0) {
      lines.push(`카테고리: ${schedule.categories.map((c) => `${c.category} ${c.count}건`).join(', ')}`);
    }
    if (schedule.overdueCount > 0) {
      lines.push(`밀린 일정: ${schedule.overdueCount}건`);
    }
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } });
  }

  // ── 수면 × 루틴 상관관계 ──
  if (correlation.goodSleepRate != null && correlation.badSleepRate != null) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*🔗 수면 × 루틴 상관관계*\n7시간+ 잔 날 루틴 ${correlation.goodSleepRate}% vs 6시간 미만 ${correlation.badSleepRate}%` },
    });
  }

  // ── 총평 ──
  blocks.push({ type: 'divider' });
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: summary } });

  return blocks;
};

// ─── LLM 한줄 총평 ─────────────────────────────────────

const generateWeeklySummary = async (
  llmClient: LifeCronConfig['llmClient'],
  data: WeeklyReportData,
): Promise<string> => {
  const { sleep, routine, schedule, correlation } = data;

  const context = [
    `주간 리포트 데이터를 보고 총평을 써줘. 잘한 점은 칭찬하고, 개선할 점은 잔소리해. 반말로, 따뜻하게.`,
    `수면: 평균 ${Math.floor(sleep.avgDuration / 60)}시간 ${sleep.avgDuration % 60}분 (${sleep.recordCount}일)`,
    `루틴: ${routine.thisWeekRate}% (${routine.thisWeekCompleted}/${routine.thisWeekTotal})${routine.lastWeekRate != null ? `, 지난주 ${routine.lastWeekRate}%` : ''}`,
    `일정: 완료 ${schedule.completedCount}, 미완료 ${schedule.incompleteCount}`,
    correlation.goodSleepRate != null && correlation.badSleepRate != null
      ? `수면-루틴 상관: 7시간+ ${correlation.goodSleepRate}% vs 6시간 미만 ${correlation.badSleepRate}%`
      : '',
  ].filter(Boolean).join('\n');

  try {
    const messages: LLMMessage[] = [
      { role: 'system', content: `${CHARACTER_PROMPT}\n주간 리포트 데이터를 보고 총평 써줘. 잘한 점 칭찬, 개선점 잔소리. 자연스러운 길이로.` },
      { role: 'user', content: context },
    ];
    const response = await llmClient.chat(messages);
    return response.text ?? '이번 주도 수고했어!';
  } catch {
    return '이번 주도 수고했어!';
  }
};

// ─── 주간 리포트 크론 태스크 ────────────────────────────

export const weeklyReportTask = async (app: App, config: LifeCronConfig): Promise<void> => {
  // 일요일(0)만 실행
  if (getKSTDayOfWeek() !== 0) return;

  const today = getTodayISO();
  const weekStart = addDays(today, -6); // 월요일
  const weekEnd = today; // 일요일

  const data = await aggregateWeeklyReport(weekStart, weekEnd);
  const summary = await generateWeeklySummary(config.llmClient, data);
  const blocks = buildWeeklyReportBlocks(data, summary);

  const headerText = `📊 주간 리포트 (${formatDateShort(weekStart)} ~ ${formatDateShort(weekEnd)})`;
  await postBlockMessage(app.client, config.channelId, headerText, blocks);
  console.warn('[Life Cron] 주간 리포트 전송 완료');
};
