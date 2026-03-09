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

interface SleepRow {
  date: string;
  bedtime: string;
  wake_time: string;
  duration_minutes: number;
  sleep_type: string;
}

interface SleepAvgRow {
  avg_duration: string | null;
  avg_bedtime_hour: string | null;
  count: string;
}

interface LateNightRow {
  consecutive_late: string;
}

interface NapRow {
  nap_count: string;
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

// ─── 수면 맥락 ──────────────────────────────────────────

/** 어젯밤 수면 + 7일 패턴 + 낮잠 */
const querySleepContext = async (timing: ContextTiming): Promise<string> => {
  const today = getTodayISO();
  const yesterday = getYesterdayISO();

  const parts: string[] = [];

  // 1. 어젯밤 수면 (date가 어제 또는 오늘인 밤잠)
  const lastNight = await query<SleepRow>(
    `SELECT date::text, bedtime, wake_time, duration_minutes, sleep_type
     FROM sleep_records
     WHERE sleep_type = 'night' AND date IN ($1, $2)
     ORDER BY date DESC LIMIT 1`,
    [yesterday, today],
  );

  if (lastNight.rows.length > 0) {
    const s = lastNight.rows[0]!;
    const hours = Math.floor(s.duration_minutes / 60);
    const mins = s.duration_minutes % 60;
    const durationText = mins > 0 ? `${hours}시간 ${mins}분` : `${hours}시간`;
    parts.push(`어젯밤 ${durationText} (${s.bedtime}~${s.wake_time})`);
  } else if (timing === 'morning') {
    parts.push('어젯밤 수면 미기록');
  } else {
    parts.push('어젯밤 수면 기록 없음');
  }

  // 2. 7일 평균 (데이터 2건 이상일 때만)
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
     WHERE sleep_type = 'night' AND date >= ($1::date - 7)`,
    [today],
  );

  const avgRow = weekAvg.rows[0];
  if (avgRow && Number(avgRow.count) >= 2) {
    const avgMins = Number(avgRow.avg_duration);
    const avgH = Math.floor(avgMins / 60);
    const avgM = avgMins % 60;
    const avgDurationText = avgM > 0 ? `${avgH}시간 ${avgM}분` : `${avgH}시간`;
    parts.push(`7일 평균 ${avgDurationText}`);
  }

  // 3. 연속 자정 이후 취침 패턴
  const latePattern = await query<LateNightRow>(
    `SELECT COUNT(*)::text as consecutive_late
     FROM (
       SELECT date, bedtime,
              ROW_NUMBER() OVER (ORDER BY date DESC) as rn
       FROM sleep_records
       WHERE sleep_type = 'night' AND date >= ($1::date - 7)
       ORDER BY date DESC
     ) sub
     WHERE bedtime::time >= '00:00' AND bedtime::time < '06:00'
       AND rn = (
         SELECT COUNT(*) FROM (
           SELECT date, bedtime,
                  ROW_NUMBER() OVER (ORDER BY date DESC) as rn2
           FROM sleep_records
           WHERE sleep_type = 'night' AND date >= ($1::date - 7)
           ORDER BY date DESC
         ) sub2
         WHERE (bedtime::time >= '00:00' AND bedtime::time < '06:00')
           AND rn2 <= rn
       )`,
    [today],
  );

  // 간소화: 최근 연속 새벽 취침 감지
  const recentLate = await query<{ cnt: string }>(
    `WITH ranked AS (
       SELECT date, bedtime,
              ROW_NUMBER() OVER (ORDER BY date DESC) as rn
       FROM sleep_records
       WHERE sleep_type = 'night' AND date >= ($1::date - 7)
     )
     SELECT COUNT(*)::text as cnt FROM ranked
     WHERE rn <= 3
       AND bedtime::time >= '00:00' AND bedtime::time < '06:00'`,
    [today],
  );

  const lateDays = Number(recentLate.rows[0]?.cnt ?? 0);
  if (lateDays >= 2) {
    parts.push(`최근 ${lateDays}일 연속 자정 이후 취침`);
  }

  // 4. 오늘 낮잠 (밤/대화 타이밍)
  if (timing !== 'morning') {
    const naps = await query<NapRow>(
      `SELECT COUNT(*)::text as nap_count
       FROM sleep_records
       WHERE sleep_type = 'nap' AND date = $1`,
      [today],
    );
    const napCount = Number(naps.rows[0]?.nap_count ?? 0);
    if (napCount > 0) {
      parts.push(`오늘 낮잠 ${napCount}회`);
    }
  }

  return parts.length > 0 ? `수면: ${parts.join('. ')}.` : '';
};

// ─── 루틴 맥락 ──────────────────────────────────────────

/** 오늘/어제 달성률 + 7일 평균 */
const queryRoutineContext = async (timing: ContextTiming): Promise<string> => {
  const today = getTodayISO();
  const yesterday = getYesterdayISO();
  const parts: string[] = [];

  // 아침에는 어제 기준, 나머지는 오늘 기준
  const targetDate = timing === 'morning' ? yesterday : today;
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
    [today],
  );

  const avgRate = weekAvg.rows[0]?.avg_rate;
  if (avgRate) {
    parts.push(`7일 평균 ${Math.round(Number(avgRate))}%`);
  }

  return parts.length > 0 ? `루틴: ${parts.join('. ')}.` : '';
};

// ─── 일정 맥락 ──────────────────────────────────────────

/** 오늘/내일 일정 수 + 밀린 일정 + 백로그 */
const queryScheduleContext = async (): Promise<string> => {
  const today = getTodayISO();
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
      parts.push(`오늘 ${total}건${incomplete > 0 && incomplete < total ? ` (미완료 ${incomplete}건)` : ''}`);
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
export const buildLifeContext = async (
  timing: ContextTiming = 'conversation',
): Promise<string> => {
  try {
    const [sleep, routine, schedule] = await Promise.all([
      querySleepContext(timing),
      queryRoutineContext(timing),
      queryScheduleContext(),
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
