/**
 * 생활 맥락 빌더.
 * 수면/루틴/일정 데이터를 순수 SQL로 조회해 시스템 프롬프트에 주입할 텍스트 생성.
 * LLM 호출 없이 ~150토큰 분량의 맥락을 제공하여 잔소리 품질 향상.
 */

import { query } from './db.js';
import { getTodayISO, getYesterdayISO } from './kst.js';

// ─── 타입 ───────────────────────────────────────────────

/** 맥락 생성 타이밍 */
export type ContextTiming = 'morning' | 'night' | 'conversation';

/** 날짜 파라미터 (한 번 계산, 서브 함수에 전달) */
interface DateParams {
  today: string;
  yesterday: string;
  userId: number;
}

interface SleepRow {
  date: string;
  bedtime: string | null;
  wake_time: string | null;
  duration_minutes: number | null;
  sleep_type: string;
  memo: string | null;
}

interface SleepAvgRow {
  avg_duration: string | null;
  avg_bedtime_hour: string | null;
  count: string;
}

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

// ─── 수면 서브 쿼리 ─────────────────────────────────────

/** 분 → "N시간 M분" 포맷 */
const fmtDuration = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
};

/** 오늘 날짜의 밤잠 + 아침잠(bedtime < 12:00 낮잠) 합산 */
const queryLastNight = async (
  { today, userId }: DateParams,
  timing: ContextTiming,
): Promise<string | null> => {
  const result = await query<SleepRow>(
    `SELECT date::text, bedtime, wake_time, duration_minutes, sleep_type, memo
     FROM sleep_records
     WHERE date = $1 AND user_id = $2
       AND (sleep_type = 'night' OR (sleep_type = 'nap' AND bedtime::time < '12:00'))
     ORDER BY CASE sleep_type WHEN 'night' THEN 0 ELSE 1 END`,
    [today, userId],
  );

  if (result.rows.length === 0) {
    return timing === 'morning' ? '어젯밤 수면 미기록' : null;
  }

  const night = result.rows.find((r) => r.sleep_type === 'night');
  const morningNaps = result.rows.filter((r) => r.sleep_type === 'nap');

  if (!night) {
    return timing === 'morning' ? '어젯밤 수면 미기록' : null;
  }

  if (night.duration_minutes == null || night.bedtime == null || night.wake_time == null) {
    return night.memo ? `어젯밤 수면 (시간 미기록, 메모 있음)` : `어젯밤 수면 (시간 미기록)`;
  }

  const nightText = `어젯밤 ${fmtDuration(night.duration_minutes)} (${night.bedtime}~${night.wake_time})`;

  // 아침잠이 있으면 합산 총합 표시
  const morningTotal = morningNaps.reduce((sum, r) => sum + (r.duration_minutes ?? 0), 0);
  if (morningTotal > 0) {
    const total = night.duration_minutes + morningTotal;
    return `${nightText} + 아침잠 ${fmtDuration(morningTotal)} = 총 ${fmtDuration(total)}`;
  }

  return nightText;
};

/** 7일 평균 수면 시간 (데이터 2건 이상일 때만) */
const queryWeekAvg = async ({ today, userId }: DateParams): Promise<string | null> => {
  const weekAvg = await query<SleepAvgRow>(
    `SELECT ROUND(AVG(duration_minutes))::text as avg_duration,
            ROUND(AVG(
              CASE WHEN bedtime::time < '06:00'
                THEN EXTRACT(HOUR FROM bedtime::time) + 24 + EXTRACT(MINUTE FROM bedtime::time) / 60.0
                ELSE EXTRACT(HOUR FROM bedtime::time) + EXTRACT(MINUTE FROM bedtime::time) / 60.0
              END
            ), 1)::text as avg_bedtime_hour,
            COUNT(*)::text as count
     FROM sleep_records
     WHERE sleep_type = 'night' AND date >= ($1::date - 7) AND duration_minutes IS NOT NULL AND user_id = $2`,
    [today, userId],
  );

  const avgRow = weekAvg.rows[0];
  if (!avgRow || Number(avgRow.count) < 2) return null;

  const avgMins = Number(avgRow.avg_duration);
  const avgH = Math.floor(avgMins / 60);
  const avgM = avgMins % 60;
  return `7일 평균 ${avgM > 0 ? `${avgH}시간 ${avgM}분` : `${avgH}시간`}`;
};

/** 최근 연속 자정 이후 취침 패턴 (실제 연속 일수만 카운트) */
const queryLateNightPattern = async ({ today, userId }: DateParams): Promise<string | null> => {
  const result = await query<{ date: string; is_late: boolean }>(
    `SELECT date::text,
            (bedtime::time >= '00:00' AND bedtime::time < '06:00') AS is_late
     FROM sleep_records
     WHERE sleep_type = 'night' AND date >= ($1::date - 14) AND bedtime IS NOT NULL AND user_id = $2
     ORDER BY date DESC
     LIMIT 10`,
    [today, userId],
  );

  let consecutive = 0;
  for (const row of result.rows) {
    if (row.is_late) consecutive++;
    else break;
  }
  return consecutive >= 2 ? `최근 ${consecutive}일 연속 자정 이후 취침` : null;
};

/** 오늘 낮잠 횟수 (아침잠 bedtime < 12:00 제외) */
const queryNaps = async ({ today, userId }: DateParams): Promise<string | null> => {
  const naps = await query<{ nap_count: string }>(
    `SELECT COUNT(*)::text as nap_count
     FROM sleep_records
     WHERE sleep_type = 'nap' AND date = $1 AND user_id = $2
       AND (bedtime IS NULL OR bedtime::time >= '12:00')`,
    [today, userId],
  );

  const napCount = Number(naps.rows[0]?.nap_count ?? 0);
  return napCount > 0 ? `오늘 낮잠 ${napCount}회` : null;
};

// ─── 수면 맥락 ──────────────────────────────────────────

/** 어젯밤 수면 + 7일 패턴 + 낮잠 */
const querySleepContext = async (dates: DateParams, timing: ContextTiming): Promise<string> => {
  const parts: string[] = [];

  const lastNight = await queryLastNight(dates, timing);
  if (lastNight) parts.push(lastNight);

  const weekAvg = await queryWeekAvg(dates);
  if (weekAvg) parts.push(weekAvg);

  const latePattern = await queryLateNightPattern(dates);
  if (latePattern) parts.push(latePattern);

  if (timing !== 'morning') {
    const nap = await queryNaps(dates);
    if (nap) parts.push(nap);
  }

  return parts.length > 0 ? `수면: ${parts.join('. ')}.` : '';
};

// ─── 루틴 맥락 ──────────────────────────────────────────

/** 오늘/어제 달성률 + 7일 평균 */
const queryRoutineContext = async (dates: DateParams, timing: ContextTiming): Promise<string> => {
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
     WHERE r.date = $1 AND r.user_id = $2`,
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
const queryScheduleContext = async ({ today, userId }: DateParams): Promise<string> => {
  const parts: string[] = [];

  // 오늘 일정 (전체 + 미완료 — event 타입은 미완료에서 제외)
  const todayResult = await query<{ total: string; incomplete: string }>(
    `SELECT COUNT(*)::text as total,
            COUNT(*) FILTER (
              WHERE (s.status = 'todo' OR s.status = 'in-progress')
                AND COALESCE(c.type, 'task') = 'task'
            )::text as incomplete
     FROM schedules s
     LEFT JOIN categories c ON c.name = s.category
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

  // 밀린 일정 (어제 이전 + todo 상태 + task 타입만)
  const overdueResult = await query<ScheduleCountRow>(
    `SELECT COUNT(*)::text as count
     FROM schedules s
     LEFT JOIN categories c ON c.name = s.category
     WHERE s.status = 'todo' AND s.date < $2 AND s.date IS NOT NULL AND s.user_id = $1
       AND COALESCE(c.type, 'task') = 'task'`,
    [userId, today],
  );
  const overdueCount = Number(overdueResult.rows[0]?.count ?? 0);
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
const queryDiaryContext = async (
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
const queryLifeThemesContext = async (userId: number): Promise<string> => {
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
const queryFortuneContext = async ({ today, userId }: DateParams): Promise<string> => {
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

// ─── 통합 빌더 ──────────────────────────────────────────

/**
 * 생활 맥락 텍스트를 생성한다.
 * 타이밍에 따라 데이터 부재 처리가 달라진다.
 * 데이터가 전혀 없으면 빈 문자열 반환.
 */
export const buildLifeContext = async (timing: ContextTiming = 'conversation', userId: number): Promise<string> => {
  try {
    const dates: DateParams = {
      today: getTodayISO(),
      yesterday: getYesterdayISO(),
      userId,
    };

    const [sleep, routine, schedule, diary, themes, fortune] = await Promise.all([
      querySleepContext(dates, timing),
      queryRoutineContext(dates, timing),
      queryScheduleContext(dates),
      queryDiaryContext(dates, timing),
      queryLifeThemesContext(userId),
      queryFortuneContext(dates),
    ]);

    const lines = [sleep, routine, schedule, diary, themes, fortune].filter(Boolean);
    if (lines.length === 0) return '';

    return `\n\n## 현재 생활 맥락\n${lines.join('\n')}`;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Life Context] 맥락 생성 실패:', msg);
    return '';
  }
};
