import { query } from '@/lib/db';
import type { SleepRecord, SleepEvent, SleepRecordWithEvents, SleepSummary, DayOfWeekPattern, DailySleep } from './types';

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

/** 기간별 수면 기록 + 이벤트 조회 (모든 sleep_type 포함) */
export async function querySleepRecordsWithEvents(
  userId: number,
  from: string,
  to: string,
): Promise<SleepRecordWithEvents[]> {
  const [recordsResult, eventsResult] = await Promise.all([
    query<SleepRecord>(
      `SELECT id, date::text, bedtime, wake_time, duration_minutes, sleep_type, memo
       FROM sleep_records
       WHERE user_id = $1 AND date BETWEEN $2 AND $3
       ORDER BY date, sleep_type, bedtime`,
      [userId, from, to],
    ),
    query<SleepEvent>(
      `SELECT e.id, e.date::text, e.event_time, e.memo
       FROM sleep_events e
       WHERE e.date BETWEEN $1 AND $2
       ORDER BY e.date, e.event_time`,
      [from, to],
    ),
  ]);

  const eventsByDate = new Map<string, SleepEvent[]>();
  const seenEventIds = new Set<number>();
  for (const e of eventsResult.rows) {
    if (seenEventIds.has(e.id)) continue;
    seenEventIds.add(e.id);
    const list = eventsByDate.get(e.date) ?? [];
    list.push(e);
    eventsByDate.set(e.date, list);
  }

  return recordsResult.rows.map((r) => ({
    ...r,
    events: r.sleep_type === 'night' ? (eventsByDate.get(r.date) ?? []) : [],
  }));
}

/** YYYY-MM-DD 문자열 사이의 모든 날짜 배열 생성 */
function eachDate(from: string, to: string): string[] {
  const dates: string[] = [];
  const current = new Date(from + 'T12:00:00Z');
  const end = new Date(to + 'T12:00:00Z');
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

/** 아침잠 판별: bedtime이 정오 이전 (00:00~11:59) */
function isMorningNap(bedtime: string | null): boolean {
  if (!bedtime) return false;
  const [h] = bedtime.split(':').map(Number);
  return (h ?? 24) < 12;
}

/** 시간 문자열(HH:MM)을 자정 기준 분으로 변환. 20:00 이후는 음수 */
function timeToMinutesFromMidnight(time: string): number {
  const [h, m] = time.split(':').map(Number);
  const total = (h ?? 0) * 60 + (m ?? 0);
  return total >= 1200 ? total - 1440 : total;
}

/** 분(자정기준)을 HH:MM 문자열로 변환 */
function minutesToTimeStr(minutes: number): string {
  let m = Math.round(minutes);
  if (m < 0) m += 1440;
  const hh = String(Math.floor(m / 60) % 24).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** 하루 기록 → DailySleep 묶기 */
export function buildDailySleeps(
  records: SleepRecordWithEvents[],
  from: string,
  to: string,
): DailySleep[] {
  const byDate = new Map<string, {
    night: SleepRecordWithEvents | null;
    morning: SleepRecord[];
    afternoon: SleepRecord[];
  }>();

  for (const d of eachDate(from, to)) {
    byDate.set(d, { night: null, morning: [], afternoon: [] });
  }

  for (const r of records) {
    const bucket = byDate.get(r.date);
    if (!bucket) continue;
    if (r.sleep_type === 'night') {
      bucket.night = r;
    } else if (isMorningNap(r.bedtime)) {
      bucket.morning.push(r);
    } else {
      bucket.afternoon.push(r);
    }
  }

  const result: DailySleep[] = [];
  for (const [date, b] of byDate) {
    const nightDur = b.night?.duration_minutes ?? 0;
    const morningDur = b.morning.reduce((s, r) => s + (r.duration_minutes ?? 0), 0);
    const morningWakes = b.morning
      .map((r) => r.wake_time)
      .filter((t): t is string => !!t)
      .sort();
    const effectiveWakeTime =
      morningWakes.length > 0
        ? morningWakes[morningWakes.length - 1]
        : (b.night?.wake_time ?? null);

    result.push({
      date,
      nightSleep: b.night,
      morningSleeps: b.morning,
      afternoonNaps: b.afternoon,
      totalNightDurationMinutes: nightDur + morningDur,
      effectiveWakeTime,
    });
  }
  return result.sort((a, b) => a.date.localeCompare(b.date));
}

/** 수면 요약 통계 계산 (DailySleep[] 기반) */
export function calculateSleepSummary(dailies: DailySleep[]): SleepSummary {
  const withNight = dailies.filter((d) => d.nightSleep?.bedtime && d.nightSleep?.wake_time);
  const withAnySleep = dailies.filter((d) => d.totalNightDurationMinutes > 0);
  const withWake = dailies.filter((d) => d.effectiveWakeTime != null);

  const totalNights = withAnySleep.length;

  if (totalNights === 0) {
    const napDaysCount = dailies.filter((d) => d.afternoonNaps.length > 0).length;
    const totalNapMinutes = dailies.reduce(
      (s, d) => s + d.afternoonNaps.reduce((x, n) => x + (n.duration_minutes ?? 0), 0),
      0,
    );
    return {
      avgDuration: 0,
      avgBedtime: '--:--',
      avgWakeTime: '--:--',
      totalMidWakes: 0,
      avgMidWakesPerNight: 0,
      regularityScore: 0,
      totalNights: 0,
      napDaysCount,
      avgNapMinutes: napDaysCount > 0 ? Math.round(totalNapMinutes / napDaysCount) : 0,
      totalNapMinutes,
    };
  }

  const totalDuration = withAnySleep.reduce((s, d) => s + d.totalNightDurationMinutes, 0);
  const avgDuration = Math.round(totalDuration / withAnySleep.length);

  const bedtimeMins = withNight.map((d) => timeToMinutesFromMidnight(d.nightSleep!.bedtime!));
  const avgBedtimeMin = bedtimeMins.length > 0
    ? bedtimeMins.reduce((a, b) => a + b, 0) / bedtimeMins.length
    : 0;

  const waketimeMins = withWake.map((d) => timeToMinutesFromMidnight(d.effectiveWakeTime!));
  const avgWakeTimeMin = waketimeMins.length > 0
    ? waketimeMins.reduce((a, b) => a + b, 0) / waketimeMins.length
    : 0;

  const totalMidWakes = dailies.reduce(
    (s, d) => s + (d.nightSleep?.events.length ?? 0),
    0,
  );

  const bedtimeStdDev = bedtimeMins.length > 0
    ? Math.sqrt(
        bedtimeMins.reduce((s, m) => s + (m - avgBedtimeMin) ** 2, 0) / bedtimeMins.length,
      )
    : 0;
  const regularityScore = Math.max(0, Math.min(100, Math.round(100 - (bedtimeStdDev / 120) * 100)));

  const napDaysCount = dailies.filter((d) => d.afternoonNaps.length > 0).length;
  const totalNapMinutes = dailies.reduce(
    (s, d) => s + d.afternoonNaps.reduce((x, n) => x + (n.duration_minutes ?? 0), 0),
    0,
  );

  return {
    avgDuration,
    avgBedtime: bedtimeMins.length > 0 ? minutesToTimeStr(avgBedtimeMin) : '--:--',
    avgWakeTime: waketimeMins.length > 0 ? minutesToTimeStr(avgWakeTimeMin) : '--:--',
    totalMidWakes,
    avgMidWakesPerNight: withAnySleep.length > 0
      ? Math.round((totalMidWakes / withAnySleep.length) * 10) / 10
      : 0,
    regularityScore,
    totalNights,
    napDaysCount,
    avgNapMinutes: napDaysCount > 0 ? Math.round(totalNapMinutes / napDaysCount) : 0,
    totalNapMinutes,
  };
}

/** 요일별 패턴 계산 (DailySleep[] 기반) */
export function calculateDayOfWeekPattern(dailies: DailySleep[]): DayOfWeekPattern[] {
  const buckets = Array.from({ length: 7 }, (_, i) => ({
    day: i,
    dayName: DAY_NAMES[i] ?? '',
    durations: [] as number[],
    bedtimes: [] as number[],
    waketimes: [] as number[],
  }));

  for (const d of dailies) {
    if (d.totalNightDurationMinutes === 0) continue;
    const dow = new Date(d.date + 'T12:00:00+09:00').getUTCDay();
    const bucket = buckets[dow];
    if (!bucket) continue;
    bucket.durations.push(d.totalNightDurationMinutes);
    if (d.nightSleep?.bedtime) {
      bucket.bedtimes.push(timeToMinutesFromMidnight(d.nightSleep.bedtime));
    }
    if (d.effectiveWakeTime) {
      bucket.waketimes.push(timeToMinutesFromMidnight(d.effectiveWakeTime));
    }
  }

  return buckets.map((b) => ({
    day: b.day,
    dayName: b.dayName,
    avgDuration: b.durations.length > 0
      ? Math.round(b.durations.reduce((a, c) => a + c, 0) / b.durations.length)
      : 0,
    avgBedtime: b.bedtimes.length > 0
      ? Math.round(b.bedtimes.reduce((a, c) => a + c, 0) / b.bedtimes.length)
      : 0,
    avgWakeTime: b.waketimes.length > 0
      ? Math.round(b.waketimes.reduce((a, c) => a + c, 0) / b.waketimes.length)
      : 0,
    count: b.durations.length,
  }));
}
