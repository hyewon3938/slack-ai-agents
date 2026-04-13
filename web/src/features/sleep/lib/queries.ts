import { query } from '@/lib/db';
import type { SleepRecord, SleepEvent, SleepRecordWithEvents, SleepSummary, DayOfWeekPattern } from './types';

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

/** 기간별 수면 기록 + 이벤트 조회 */
export async function querySleepRecordsWithEvents(
  userId: number,
  from: string,
  to: string,
): Promise<SleepRecordWithEvents[]> {
  const [recordsResult, eventsResult] = await Promise.all([
    query<SleepRecord>(
      `SELECT id, date::text, bedtime, wake_time, duration_minutes, sleep_type, memo
       FROM sleep_records
       WHERE user_id = $1 AND date BETWEEN $2 AND $3 AND sleep_type = 'night'
       ORDER BY date`,
      [userId, from, to],
    ),
    query<SleepEvent>(
      `SELECT id, date::text, event_time, memo
       FROM sleep_events
       WHERE date BETWEEN $1 AND $2
       ORDER BY date, event_time`,
      [from, to],
    ),
  ]);

  const eventsByDate = new Map<string, SleepEvent[]>();
  for (const e of eventsResult.rows) {
    const list = eventsByDate.get(e.date) ?? [];
    list.push(e);
    eventsByDate.set(e.date, list);
  }

  return recordsResult.rows.map((r) => ({
    ...r,
    events: eventsByDate.get(r.date) ?? [],
  }));
}

/** 시간 문자열(HH:MM)을 자정 기준 분으로 변환. 20:00 이후는 음수 */
function timeToMinutesFromMidnight(time: string): number {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + (m ?? 0);
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

/** 수면 요약 통계 계산 */
export function calculateSleepSummary(
  records: SleepRecordWithEvents[],
): SleepSummary {
  const validRecords = records.filter((r) => r.bedtime && r.wake_time && r.duration_minutes);

  if (validRecords.length === 0) {
    return {
      avgDuration: 0, avgBedtime: '--:--', avgWakeTime: '--:--',
      totalMidWakes: 0, avgMidWakesPerNight: 0, regularityScore: 0, totalNights: 0,
    };
  }

  const totalDuration = validRecords.reduce((s, r) => s + (r.duration_minutes ?? 0), 0);
  const avgDuration = totalDuration / validRecords.length;

  const bedtimeMins = validRecords.map((r) => timeToMinutesFromMidnight(r.bedtime!));
  const waketimeMins = validRecords.map((r) => timeToMinutesFromMidnight(r.wake_time!));
  const avgBedtimeMin = bedtimeMins.reduce((a, b) => a + b, 0) / bedtimeMins.length;
  const avgWakeTimeMin = waketimeMins.reduce((a, b) => a + b, 0) / waketimeMins.length;

  const totalMidWakes = records.reduce((s, r) => s + r.events.length, 0);

  const bedtimeStdDev = Math.sqrt(
    bedtimeMins.reduce((s, m) => s + (m - avgBedtimeMin) ** 2, 0) / bedtimeMins.length,
  );
  const regularityScore = Math.max(0, Math.min(100, Math.round(100 - (bedtimeStdDev / 120) * 100)));

  return {
    avgDuration: Math.round(avgDuration),
    avgBedtime: minutesToTimeStr(avgBedtimeMin),
    avgWakeTime: minutesToTimeStr(avgWakeTimeMin),
    totalMidWakes,
    avgMidWakesPerNight: validRecords.length > 0
      ? Math.round((totalMidWakes / validRecords.length) * 10) / 10
      : 0,
    regularityScore,
    totalNights: validRecords.length,
  };
}

/** 요일별 패턴 계산 */
export function calculateDayOfWeekPattern(
  records: SleepRecordWithEvents[],
): DayOfWeekPattern[] {
  const buckets = Array.from({ length: 7 }, (_, i) => ({
    day: i,
    dayName: DAY_NAMES[i] ?? '',
    durations: [] as number[],
    bedtimes: [] as number[],
    waketimes: [] as number[],
  }));

  for (const r of records) {
    if (!r.bedtime || !r.wake_time || !r.duration_minutes) continue;
    const dow = new Date(r.date + 'T12:00:00+09:00').getUTCDay();
    const bucket = buckets[dow];
    if (!bucket) continue;
    bucket.durations.push(r.duration_minutes);
    bucket.bedtimes.push(timeToMinutesFromMidnight(r.bedtime));
    bucket.waketimes.push(timeToMinutesFromMidnight(r.wake_time));
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
