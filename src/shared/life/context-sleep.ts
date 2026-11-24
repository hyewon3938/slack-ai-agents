/** 생활 맥락 — 수면 조회. */

import { query } from '../db.js';
import type { ContextTiming, DateParams } from './context-types.js';

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

// ─── 수면 서브 쿼리 ─────────────────────────────────────

/** 분 → "N시간 M분" 포맷 */
const fmtDuration = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
};

/**
 * 오늘 날짜의 밤잠 + 아침잠(bedtime < 12:00 낮잠) 합산.
 * 분할 수면(같은 날짜 night 여러 세그먼트)은 전체 합산 시간으로 표기하고,
 * 세그먼트가 2개 이상이면 구간을 나열한다 (예: 6시간 (00:30-03:00 · 03:45-09:00)).
 */
const queryLastNight = async (
  { today, userId }: DateParams,
  timing: ContextTiming,
): Promise<string | null> => {
  const result = await query<SleepRow>(
    `SELECT date::text, bedtime, wake_time, duration_minutes, sleep_type, memo
     FROM sleep_records
     WHERE date = $1 AND user_id = $2
       AND (sleep_type = 'night' OR (sleep_type = 'nap' AND bedtime::time < '12:00'))
     ORDER BY CASE sleep_type WHEN 'night' THEN 0 ELSE 1 END, bedtime`,
    [today, userId],
  );

  const nightRows = result.rows.filter((r) => r.sleep_type === 'night');
  const morningNaps = result.rows.filter((r) => r.sleep_type === 'nap');

  if (nightRows.length === 0) {
    return timing === 'morning' ? '어젯밤 수면 미기록' : null;
  }

  // 시간이 온전히 기록된 세그먼트만 합산·표기 대상 (메모 전용 행 제외)
  const timed = nightRows.filter(
    (r) => r.duration_minutes != null && r.bedtime != null && r.wake_time != null,
  );

  if (timed.length === 0) {
    return nightRows.some((r) => r.memo != null)
      ? `어젯밤 수면 (시간 미기록, 메모 있음)`
      : `어젯밤 수면 (시간 미기록)`;
  }

  const nightTotal = timed.reduce((sum, r) => sum + (r.duration_minutes ?? 0), 0);
  const nightText =
    timed.length === 1
      ? `어젯밤 ${fmtDuration(nightTotal)} (${timed[0].bedtime}~${timed[0].wake_time})`
      : `어젯밤 ${fmtDuration(nightTotal)} (${timed
          .map((r) => `${r.bedtime}-${r.wake_time}`)
          .join(' · ')})`;

  // 아침잠이 있으면 합산 총합 표시
  const morningTotal = morningNaps.reduce((sum, r) => sum + (r.duration_minutes ?? 0), 0);
  if (morningTotal > 0) {
    const total = nightTotal + morningTotal;
    return `${nightText} + 아침잠 ${fmtDuration(morningTotal)} = 총 ${fmtDuration(total)}`;
  }

  return nightText;
};

/** 7일 평균 수면 시간 (데이터 2건 이상일 때만) — 분할 수면은 날짜별 합산 후 평균 */
const queryWeekAvg = async ({ today, userId }: DateParams): Promise<string | null> => {
  const weekAvg = await query<SleepAvgRow>(
    `WITH daily AS (
       SELECT date,
              SUM(duration_minutes) AS day_minutes,
              MIN(CASE WHEN bedtime::time >= '20:00'
                    THEN EXTRACT(EPOCH FROM bedtime::time) / 60 - 1440
                    ELSE EXTRACT(EPOCH FROM bedtime::time) / 60 END) AS onset_minutes
       FROM sleep_records
       WHERE sleep_type = 'night' AND date >= ($1::date - 7) AND duration_minutes IS NOT NULL AND user_id = $2
       GROUP BY date
     )
     SELECT ROUND(AVG(day_minutes))::text as avg_duration,
            ROUND(AVG(onset_minutes) / 60.0, 1)::text as avg_bedtime_hour,
            COUNT(*)::text as count
     FROM daily`,
    [today, userId],
  );

  const avgRow = weekAvg.rows[0];
  if (!avgRow || Number(avgRow.count) < 2) return null;

  const avgMins = Number(avgRow.avg_duration);
  const avgH = Math.floor(avgMins / 60);
  const avgM = avgMins % 60;
  return `7일 평균 ${avgM > 0 ? `${avgH}시간 ${avgM}분` : `${avgH}시간`}`;
};

/** 최근 연속 자정 이후 취침 패턴 (실제 연속 일수만 카운트) — 분할 수면은 날짜별 첫 세그먼트 취침 기준 */
const queryLateNightPattern = async ({ today, userId }: DateParams): Promise<string | null> => {
  const result = await query<{ date: string; is_late: boolean }>(
    `WITH daily AS (
       SELECT date,
              MIN(CASE WHEN bedtime::time >= '20:00'
                    THEN EXTRACT(EPOCH FROM bedtime::time) / 60 - 1440
                    ELSE EXTRACT(EPOCH FROM bedtime::time) / 60 END) AS onset_minutes
       FROM sleep_records
       WHERE sleep_type = 'night' AND date >= ($1::date - 14) AND bedtime IS NOT NULL AND user_id = $2
       GROUP BY date
     )
     SELECT date::text,
            (onset_minutes >= 0 AND onset_minutes < 360) AS is_late
     FROM daily
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
export const querySleepContext = async (dates: DateParams, timing: ContextTiming): Promise<string> => {
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
