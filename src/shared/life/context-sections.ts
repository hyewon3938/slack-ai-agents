/** 생활 맥락 — 루틴·일정·일기·테마·운세 조회. */

import { query } from '../db.js';
import { countOverdueTasks } from '../life-queries.js';
import type { ContextTiming, DateParams } from './context-types.js';

interface RoutineDayRow {
  total: string;
  completed: string;
}

interface RoutineWeekRow {
  avg_rate: string | null;
}

interface ScheduleCountRow {
  count: string;
}

// ─── 루틴 맥락 ──────────────────────────────────────────

/** 오늘/어제 달성률 + 7일 평균 */
export const queryRoutineContext = async (dates: DateParams, timing: ContextTiming): Promise<string> => {
  const parts: string[] = [];
  const { today, userId } = dates;

  // 아침에는 어제 기준, 나머지는 오늘 기준
  const targetDate = timing === 'morning' ? dates.yesterday : today;
  const label = timing === 'morning' ? '어제' : '오늘';

  const dayStats = await query<RoutineDayRow>(
    `SELECT COUNT(*)::text as total,
            COUNT(*) FILTER (WHERE r.completed)::text as completed
     FROM routine_records r
     JOIN routine_templates t ON r.template_id = t.id
     WHERE r.date = $1 AND r.user_id = $2
       AND r.entry_type = 'scheduled'`,
    [targetDate, userId],
  );

  const row = dayStats.rows[0];
  if (row && Number(row.total) > 0) {
    const total = Number(row.total);
    const completed = Number(row.completed);
    const rate = Math.round((completed / total) * 100);
    parts.push(`${label} ${completed}/${total} 완료 (${rate}%)`);
  }

  // 7일 평균
  const weekAvg = await query<RoutineWeekRow>(
    `SELECT ROUND(AVG(daily_rate))::text as avg_rate
     FROM (
       SELECT r.date,
              COUNT(*) FILTER (WHERE r.completed)::float / NULLIF(COUNT(*), 0) * 100 as daily_rate
       FROM routine_records r
       WHERE r.date >= ($1::date - 7) AND r.date < $1 AND r.user_id = $2
         AND r.entry_type = 'scheduled'
       GROUP BY r.date
     ) sub`,
    [today, userId],
  );

  const avgRate = weekAvg.rows[0]?.avg_rate;
  if (avgRate) {
    parts.push(`7일 평균 ${Math.round(Number(avgRate))}%`);
  }

  return parts.length > 0 ? `루틴: ${parts.join('. ')}.` : '';
};

// ─── 일정 맥락 ──────────────────────────────────────────

/** 오늘/내일 일정 수 + 밀린 일정 + 백로그 */
export const queryScheduleContext = async ({ today, userId }: DateParams): Promise<string> => {
  const parts: string[] = [];

  // 오늘 일정 (전체 + 미완료 — event 타입은 미완료에서 제외)
  // category_type은 child 우선, 없으면 parent에서 가져옴
  const todayResult = await query<{ total: string; incomplete: string }>(
    `SELECT COUNT(*)::text as total,
            COUNT(*) FILTER (
              WHERE (s.status = 'todo' OR s.status = 'in-progress')
                AND COALESCE(c.type, p.type, 'task') = 'task'
            )::text as incomplete
     FROM schedules s
     LEFT JOIN categories c ON c.id = s.category_id
     LEFT JOIN categories p ON p.id = c.parent_id
     WHERE s.status != 'cancelled' AND s.user_id = $1
       AND (s.date = $2 OR (s.date <= $2 AND s.end_date >= $2))`,
    [userId, today],
  );

  const todayRow = todayResult.rows[0];
  if (todayRow) {
    const total = Number(todayRow.total);
    const incomplete = Number(todayRow.incomplete);
    if (total > 0) {
      parts.push(
        `오늘 ${total}건${incomplete > 0 && incomplete < total ? ` (미완료 ${incomplete}건)` : ''}`,
      );
    } else {
      parts.push('오늘 일정 없음');
    }
  }

  // 내일 일정
  const tomorrowResult = await query<ScheduleCountRow>(
    `SELECT COUNT(*)::text as count
     FROM schedules
     WHERE status != 'cancelled' AND user_id = $1
       AND (date = ($2::date + 1) OR (date <= ($2::date + 1) AND end_date >= ($2::date + 1)))`,
    [userId, today],
  );
  const tomorrowCount = Number(tomorrowResult.rows[0]?.count ?? 0);
  if (tomorrowCount > 0) {
    parts.push(`내일 ${tomorrowCount}건`);
  }

  // 밀린 일정 (task 타입만) — 공유 헬퍼 countOverdueTasks로 단일화
  const overdueCount = await countOverdueTasks(today, userId);
  if (overdueCount > 0) {
    parts.push(`밀린 일정 ${overdueCount}건`);
  }

  // 백로그 (date IS NULL)
  const backlogResult = await query<ScheduleCountRow>(
    `SELECT COUNT(*)::text as count
     FROM schedules
     WHERE date IS NULL AND status = 'todo' AND user_id = $1`,
    [userId],
  );
  const backlogCount = Number(backlogResult.rows[0]?.count ?? 0);
  if (backlogCount > 0) {
    parts.push(`백로그 ${backlogCount}건`);
  }

  return parts.length > 0 ? `일정: ${parts.join(', ')}.` : '';
};

// ─── 일기 맥락 ──────────────────────────────────────────

/** 최근 일기 (morning/conversation: 오늘+어제, night: 오늘만, 각 200자 제한) */
export const queryDiaryContext = async (
  { today, yesterday, userId }: DateParams,
  timing: ContextTiming,
): Promise<string> => {
  // 밤 리뷰에서 어제 일기를 포함하면 LLM이 어제 활동을 오늘로 혼동함
  const dates = timing === 'night' ? [today] : [today, yesterday];
  const placeholders = dates.map((_, i) => `$${i + 2}`).join(', ');

  const result = await query<{ date: string; content: string }>(
    `SELECT date::text, content FROM diary_entries
     WHERE user_id = $1 AND date IN (${placeholders}) ORDER BY date DESC`,
    [userId, ...dates],
  );

  if (result.rows.length === 0) return '';

  const lines = result.rows.map((r) => {
    const label = r.date === today ? '오늘' : '어제';
    const content = r.content.length > 200 ? r.content.slice(0, 200) + '...' : r.content;
    return `${label}: ${content}`;
  });
  return `일기: ${lines.join(' | ')}`;
};

// ─── 삶의 테마 맥락 ─────────────────────────────────────

/** 활성 삶의 테마 (상위 5개, detail 80자 제한) */
export const queryLifeThemesContext = async (userId: number): Promise<string> => {
  const result = await query<{ theme: string; category: string; detail: string | null }>(
    `SELECT theme, category, detail FROM life_themes
     WHERE active = true AND user_id = $1 ORDER BY mention_count DESC LIMIT 5`,
    [userId],
  );

  if (result.rows.length === 0) return '';

  const lines = result.rows.map(
    (r) => `[${r.category}] ${r.theme}${r.detail ? `: ${r.detail.slice(0, 80)}` : ''}`,
  );
  return `삶의 테마: ${lines.join('. ')}`;
};

// ─── 운세 맥락 ──────────────────────────────────────────

/** 오늘 일운 요약 (summary + advice만) */
export const queryFortuneContext = async ({ today, userId }: DateParams): Promise<string> => {
  const result = await query<{ summary: string | null; advice: string | null }>(
    `SELECT summary, advice FROM fortune_analyses
     WHERE user_id = $1 AND date = $2 AND period = 'daily'
     ORDER BY created_at DESC LIMIT 1`,
    [userId, today],
  );

  const row = result.rows[0];
  if (!row) return '';

  const parts: string[] = [];
  if (row.summary) parts.push(row.summary);
  if (row.advice) parts.push(`조언: ${row.advice}`);
  return parts.length > 0 ? `오늘 운세: ${parts.join('. ')}` : '';
};
