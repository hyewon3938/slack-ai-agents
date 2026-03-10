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

/** 어젯밤 수면 시간 + 취침/기상 */
const queryLastNight = async (
  { today, yesterday }: DateParams,
  timing: ContextTiming,
): Promise<string | null> => {
  const lastNight = await query<SleepRow>(
    `SELECT date::text, bedtime, wake_time, duration_minutes, sleep_type, memo
     FROM sleep_records
     WHERE sleep_type = 'night' AND date IN ($1, $2)
     ORDER BY date DESC LIMIT 1`,
    [yesterday, today],
  );

  const s = lastNight.rows[0];
  if (s) {
    if (s.duration_minutes == null || s.bedtime == null || s.wake_time == null) {
      return s.memo ? `어젯밤 수면 (시간 미기록, 메모 있음)` : `어젯밤 수면 (시간 미기록)`;
    }
    const hours = Math.floor(s.duration_minutes / 60);
    const mins = s.duration_minutes % 60;
    const durationText = mins > 0 ? `${hours}시간 ${mins}분` : `${hours}시간`;
    return `어젯밤 ${durationText} (${s.bedtime}~${s.wake_time})`;
  }

  return timing === 'morning' ? '어젯밤 수면 미기록' : '어젯밤 수면 기록 없음';
};

/** 7일 평균 수면 시간 (데이터 2건 이상일 때만) */
const queryWeekAvg = async ({ today }: DateParams): Promise<string | null> => {
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
     WHERE sleep_type = 'night' AND date >= ($1::date - 7) AND duration_minutes IS NOT NULL`,
    [today],
  );

  const avgRow = weekAvg.rows[0];
  if (!avgRow || Number(avgRow.count) < 2) return null;

  const avgMins = Number(avgRow.avg_duration);
  const avgH = Math.floor(avgMins / 60);
  const avgM = avgMins % 60;
  return `7일 평균 ${avgM > 0 ? `${avgH}시간 ${avgM}분` : `${avgH}시간`}`;
};

/** 최근 연속 자정 이후 취침 패턴 */
const queryLateNightPattern = async ({ today }: DateParams): Promise<string | null> => {
  const recentLate = await query<{ cnt: string }>(
    `WITH ranked AS (
       SELECT date, bedtime,
              ROW_NUMBER() OVER (ORDER BY date DESC) as rn
       FROM sleep_records
       WHERE sleep_type = 'night' AND date >= ($1::date - 7) AND bedtime IS NOT NULL
     )
     SELECT COUNT(*)::text as cnt FROM ranked
     WHERE rn <= 3
       AND bedtime::time >= '00:00' AND bedtime::time < '06:00'`,
    [today],
  );

  const lateDays = Number(recentLate.rows[0]?.cnt ?? 0);
  return lateDays >= 2 ? `최근 ${lateDays}일 연속 자정 이후 취침` : null;
};

/** 오늘 낮잠 횟수 (morning 제외) */
const queryNaps = async ({ today }: DateParams): Promise<string | null> => {
  const naps = await query<{ nap_count: string }>(
    `SELECT COUNT(*)::text as nap_count
     FROM sleep_records
     WHERE sleep_type = 'nap' AND date = $1`,
    [today],
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

  // 아침에는 어제 기준, 나머지는 오늘 기준
  const targetDate = timing === 'morning' ? dates.yesterday : dates.today;
  const label = timing === 'morning' ? '어제' : '오늘';

  const dayStats = await query<RoutineDayRow>(
    `SELECT COUNT(*)::text as total,
            COUNT(*) FILTER (WHERE r.completed)::text as completed
     FROM routine_records r
     JOIN routine_templates t ON r.template_id = t.id
     WHERE r.date = $1`,
    [targetDate],
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
       WHERE r.date >= ($1::date - 7) AND r.date < $1
       GROUP BY r.date
     ) sub`,
    [dates.today],
  );

  const avgRate = weekAvg.rows[0]?.avg_rate;
  if (avgRate) {
    parts.push(`7일 평균 ${Math.round(Number(avgRate))}%`);
  }

  return parts.length > 0 ? `루틴: ${parts.join('. ')}.` : '';
};

// ─── 일정 맥락 ──────────────────────────────────────────

/** 오늘/내일 일정 수 + 밀린 일정 + 백로그 */
const queryScheduleContext = async ({ today }: DateParams): Promise<string> => {
  const parts: string[] = [];

  // 오늘 일정 (전체 + 미완료)
  const todayResult = await query<{ total: string; incomplete: string }>(
    `SELECT COUNT(*)::text as total,
            COUNT(*) FILTER (WHERE status = 'todo' OR status = 'in-progress')::text as incomplete
     FROM schedules
     WHERE status != 'cancelled'
       AND (date = $1 OR (date <= $1 AND end_date >= $1))`,
    [today],
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
     WHERE status != 'cancelled'
       AND (date = ($1::date + 1) OR (date <= ($1::date + 1) AND end_date >= ($1::date + 1)))`,
    [today],
  );
  const tomorrowCount = Number(tomorrowResult.rows[0]?.count ?? 0);
  if (tomorrowCount > 0) {
    parts.push(`내일 ${tomorrowCount}건`);
  }

  // 밀린 일정 (어제 이전 + todo 상태)
  const overdueResult = await query<ScheduleCountRow>(
    `SELECT COUNT(*)::text as count
     FROM schedules
     WHERE status = 'todo' AND date < $1 AND date IS NOT NULL`,
    [today],
  );
  const overdueCount = Number(overdueResult.rows[0]?.count ?? 0);
  if (overdueCount > 0) {
    parts.push(`밀린 일정 ${overdueCount}건`);
  }

  // 백로그 (date IS NULL)
  const backlogResult = await query<ScheduleCountRow>(
    `SELECT COUNT(*)::text as count
     FROM schedules
     WHERE date IS NULL AND status = 'todo'`,
  );
  const backlogCount = Number(backlogResult.rows[0]?.count ?? 0);
  if (backlogCount > 0) {
    parts.push(`백로그 ${backlogCount}건`);
  }

  return parts.length > 0 ? `일정: ${parts.join(', ')}.` : '';
};

// ─── 통합 빌더 ──────────────────────────────────────────

/**
 * 생활 맥락 텍스트를 생성한다.
 * 타이밍에 따라 데이터 부재 처리가 달라진다.
 * 데이터가 전혀 없으면 빈 문자열 반환.
 */
export const buildLifeContext = async (timing: ContextTiming = 'conversation'): Promise<string> => {
  try {
    const dates: DateParams = {
      today: getTodayISO(),
      yesterday: getYesterdayISO(),
    };

    const [sleep, routine, schedule] = await Promise.all([
      querySleepContext(dates, timing),
      queryRoutineContext(dates, timing),
      queryScheduleContext(dates),
    ]);

    const lines = [sleep, routine, schedule].filter(Boolean);
    if (lines.length === 0) return '';

    return `\n\n## 현재 생활 맥락\n${lines.join('\n')}`;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Life Context] 맥락 생성 실패:', msg);
    return '';
  }
};
