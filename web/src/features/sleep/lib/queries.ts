import { query, queryOne } from '@/lib/db';
import { calculateSleepScores } from './scores';
import type {
  SleepRecord,
  SleepEvent,
  SleepRecordWithEvents,
  SleepRecordInput,
  SleepEventInput,
  SleepSummary,
  DayOfWeekPattern,
  DailySleep,
} from './types';

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

/** 기간별 수면 기록 + 이벤트 조회 (모든 sleep_type 포함) */
export async function querySleepRecordsWithEvents(
  userId: number,
  from: string,
  to: string,
): Promise<SleepRecordWithEvents[]> {
  const [recordsResult, eventsResult] = await Promise.all([
    query<SleepRecord>(
      `SELECT id, date::text, bedtime, wake_time, duration_minutes, sleep_type, memo, tags
       FROM sleep_records
       WHERE user_id = $1 AND date BETWEEN $2 AND $3
       ORDER BY date, sleep_type, bedtime`,
      [userId, from, to],
    ),
    query<SleepEvent>(
      `SELECT e.id, e.date::text, e.event_time, e.memo
       FROM sleep_events e
       WHERE e.user_id = $1 AND e.date BETWEEN $2 AND $3
       ORDER BY e.date, e.event_time`,
      [userId, from, to],
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

/** 시간 문자열(HH:MM)을 자정 기준 분으로 변환. 20:00 이후는 음수 (scores.ts에서도 사용) */
export function timeToMinutesFromMidnight(time: string): number {
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

/** night 레코드들의 events를 date 레벨로 승격 (id dedup + event_time 오름차순) */
function collectNightEvents(nightRecords: SleepRecordWithEvents[]): SleepEvent[] {
  const seen = new Set<number>();
  const events: SleepEvent[] = [];
  for (const r of nightRecords) {
    for (const e of r.events) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      events.push(e);
    }
  }
  return events.sort((a, b) => a.event_time.localeCompare(b.event_time));
}

/** 세그먼트 수학 — 종료(래핑 분) = bedtime래핑 + duration. waso = 세그먼트 사이 갭 합 */
function calculateSegmentMath(segments: SleepRecordWithEvents[]): {
  wasoMinutes: number;
  timeInBedMinutes: number;
} {
  if (segments.length === 0) return { wasoMinutes: 0, timeInBedMinutes: 0 };
  const starts = segments.map((s) => timeToMinutesFromMidnight(s.bedtime!));
  const ends = segments.map((s, i) => starts[i]! + (s.duration_minutes ?? 0));
  let waso = 0;
  for (let i = 1; i < segments.length; i++) {
    waso += Math.max(0, starts[i]! - ends[i - 1]!);
  }
  return { wasoMinutes: waso, timeInBedMinutes: ends[ends.length - 1]! - starts[0]! };
}

/** 기상 시각 — ① 아침잠 최후 wake ② 마지막 세그먼트 wake_time ③ 종료 래핑 환산(duration 있을 때만) ④ null */
function resolveEffectiveWakeTime(
  segments: SleepRecordWithEvents[],
  morning: SleepRecord[],
): string | null {
  const morningWakes = morning
    .map((r) => r.wake_time)
    .filter((t): t is string => !!t)
    .sort();
  if (morningWakes.length > 0) return morningWakes[morningWakes.length - 1]!;

  const last = segments[segments.length - 1];
  if (!last) return null;
  if (last.wake_time) return last.wake_time;
  if (last.duration_minutes != null) {
    return minutesToTimeStr(timeToMinutesFromMidnight(last.bedtime!) + last.duration_minutes);
  }
  return null;
}

/** 하루 기록 → DailySleep 묶기 (같은 날 night 여러 건 = 분할 수면 세그먼트로 보존) */
export function buildDailySleeps(
  records: SleepRecordWithEvents[],
  from: string,
  to: string,
): DailySleep[] {
  const byDate = new Map<
    string,
    {
      nightSegments: SleepRecordWithEvents[];
      nightMemoRecords: SleepRecordWithEvents[];
      morning: SleepRecord[];
      afternoon: SleepRecord[];
    }
  >();

  for (const d of eachDate(from, to)) {
    byDate.set(d, { nightSegments: [], nightMemoRecords: [], morning: [], afternoon: [] });
  }

  for (const r of records) {
    const bucket = byDate.get(r.date);
    if (!bucket) continue;
    if (r.sleep_type === 'night') {
      if (r.bedtime) bucket.nightSegments.push(r);
      else bucket.nightMemoRecords.push(r);
    } else if (isMorningNap(r.bedtime)) {
      bucket.morning.push(r);
    } else {
      bucket.afternoon.push(r);
    }
  }

  const result: DailySleep[] = [];
  for (const [date, b] of byDate) {
    const nightSegments = b.nightSegments.sort(
      (x, y) => timeToMinutesFromMidnight(x.bedtime!) - timeToMinutesFromMidnight(y.bedtime!),
    );
    const nightEvents = collectNightEvents([...nightSegments, ...b.nightMemoRecords]);
    const { wasoMinutes, timeInBedMinutes } = calculateSegmentMath(nightSegments);
    const segmentDur = nightSegments.reduce((s, r) => s + (r.duration_minutes ?? 0), 0);
    const morningDur = b.morning.reduce((s, r) => s + (r.duration_minutes ?? 0), 0);

    result.push({
      date,
      nightSegments,
      nightMemoRecords: b.nightMemoRecords,
      nightEvents,
      morningSleeps: b.morning,
      afternoonNaps: b.afternoon,
      totalNightDurationMinutes: segmentDur + morningDur,
      effectiveWakeTime: resolveEffectiveWakeTime(nightSegments, b.morning),
      wasoMinutes,
      timeInBedMinutes,
      fragmentationCount: nightEvents.length + Math.max(0, nightSegments.length - 1),
    });
  }
  return result.sort((a, b) => a.date.localeCompare(b.date));
}

/** 수면 요약 통계 계산 (DailySleep[] 기반) */
export function calculateSleepSummary(dailies: DailySleep[]): SleepSummary {
  const withAnySleep = dailies.filter((d) => d.totalNightDurationMinutes > 0);
  const withOnset = dailies.filter((d) => d.nightSegments.length > 0);
  const withWake = dailies.filter((d) => d.effectiveWakeTime != null);

  const totalNights = withAnySleep.length;

  const napDaysCount = dailies.filter((d) => d.afternoonNaps.length > 0).length;
  const totalNapMinutes = dailies.reduce(
    (s, d) => s + d.afternoonNaps.reduce((x, n) => x + (n.duration_minutes ?? 0), 0),
    0,
  );
  const totalMidWakes = dailies.reduce((s, d) => s + d.nightEvents.length, 0);
  const scores = calculateSleepScores(dailies);

  const avgWasoMinutes =
    withOnset.length > 0
      ? Math.round(withOnset.reduce((s, d) => s + d.wasoMinutes, 0) / withOnset.length)
      : 0;

  const inBedDays = dailies.filter((d) => d.timeInBedMinutes > 0);
  const segmentDurSum = inBedDays.reduce(
    (s, d) => s + d.nightSegments.reduce((x, r) => x + (r.duration_minutes ?? 0), 0),
    0,
  );
  const inBedSum = inBedDays.reduce((s, d) => s + d.timeInBedMinutes, 0);
  const avgEfficiencyPct =
    inBedDays.length > 0 ? Math.round((segmentDurSum / inBedSum) * 100) : null;

  const base = {
    totalMidWakes,
    scores,
    avgEfficiencyPct,
    avgWasoMinutes,
    totalNights,
    napDaysCount,
    avgNapMinutes: napDaysCount > 0 ? Math.round(totalNapMinutes / napDaysCount) : 0,
    totalNapMinutes,
  };

  if (totalNights === 0) {
    return {
      ...base,
      avgDuration: 0,
      avgBedtime: '--:--',
      avgWakeTime: '--:--',
      avgMidWakesPerNight: 0,
    };
  }

  const totalDuration = withAnySleep.reduce((s, d) => s + d.totalNightDurationMinutes, 0);
  const avgDuration = Math.round(totalDuration / withAnySleep.length);

  const bedtimeMins = withOnset.map((d) => timeToMinutesFromMidnight(d.nightSegments[0]!.bedtime!));
  const avgBedtimeMin =
    bedtimeMins.length > 0 ? bedtimeMins.reduce((a, b) => a + b, 0) / bedtimeMins.length : 0;

  const waketimeMins = withWake.map((d) => timeToMinutesFromMidnight(d.effectiveWakeTime!));
  const avgWakeTimeMin =
    waketimeMins.length > 0 ? waketimeMins.reduce((a, b) => a + b, 0) / waketimeMins.length : 0;

  return {
    ...base,
    avgDuration,
    avgBedtime: bedtimeMins.length > 0 ? minutesToTimeStr(avgBedtimeMin) : '--:--',
    avgWakeTime: waketimeMins.length > 0 ? minutesToTimeStr(avgWakeTimeMin) : '--:--',
    avgMidWakesPerNight: Math.round((totalMidWakes / withAnySleep.length) * 10) / 10,
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
    const onset = d.nightSegments[0]?.bedtime;
    if (onset) {
      bucket.bedtimes.push(timeToMinutesFromMidnight(onset));
    }
    if (d.effectiveWakeTime) {
      bucket.waketimes.push(timeToMinutesFromMidnight(d.effectiveWakeTime));
    }
  }

  return buckets.map((b) => ({
    day: b.day,
    dayName: b.dayName,
    avgDuration:
      b.durations.length > 0
        ? Math.round(b.durations.reduce((a, c) => a + c, 0) / b.durations.length)
        : 0,
    avgBedtime:
      b.bedtimes.length > 0
        ? Math.round(b.bedtimes.reduce((a, c) => a + c, 0) / b.bedtimes.length)
        : 0,
    avgWakeTime:
      b.waketimes.length > 0
        ? Math.round(b.waketimes.reduce((a, c) => a + c, 0) / b.waketimes.length)
        : 0,
    count: b.durations.length,
  }));
}

// ─── 수면 기록/이벤트 쓰기 (웹 대시보드 입력, #595) ───────────────────

/**
 * duration_minutes 계산 — 서버(TS)에서 계산해 파라미터로 넘긴다.
 * bedtime·wake_time('HH:MM')이 둘 다 있을 때만, 자정 넘김 보정: (wake − bed + 1440) mod 1440 → 0~1439분.
 *
 * SQL 표현식 대신 TS 계산인 이유(#600): bedtime을 `bedtime = $n`(text)과 `$n::time`(time) 양쪽에
 * 쓰면 pg가 같은 파라미터를 두 타입으로 추론해 "inconsistent types deduced" 오류가 났다.
 * TS 계산은 duration을 단순 정수 파라미터로 넘겨 타입 충돌을 원천 제거하고, 순수 함수라 단위 테스트도 된다.
 */
export function computeDurationMinutes(
  bedtime: string | null,
  wakeTime: string | null,
): number | null {
  if (!bedtime || !wakeTime) return null;
  const toMinutes = (t: string): number => {
    const [h, m] = t.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  return (toMinutes(wakeTime) - toMinutes(bedtime) + 1440) % 1440;
}

/** sleep_records 쓰기 결과 컬럼 (SleepRecord 매핑) */
const SLEEP_RECORD_RETURNING =
  'id, date::text, bedtime, wake_time, duration_minutes, sleep_type, memo, tags';

/** 수면 기록 추가 (duration은 서버에서 계산해 파라미터로 전달) */
export async function createSleepRecord(
  userId: number,
  input: SleepRecordInput,
): Promise<SleepRecord> {
  const row = await queryOne<SleepRecord>(
    `INSERT INTO sleep_records (user_id, date, sleep_type, bedtime, wake_time, duration_minutes, tags, memo)
     VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8)
     RETURNING ${SLEEP_RECORD_RETURNING}`,
    [
      userId,
      input.date,
      input.sleep_type,
      input.bedtime,
      input.wake_time,
      computeDurationMinutes(input.bedtime, input.wake_time),
      input.tags ?? [],
      input.memo ?? null,
    ],
  );
  if (!row) throw new Error('createSleepRecord: INSERT returned no rows');
  return row;
}

/** 수면 기록 수정 (전체 필드 교체, duration 재계산). 없으면 null */
export async function updateSleepRecord(
  userId: number,
  id: number,
  input: SleepRecordInput,
): Promise<SleepRecord | null> {
  return queryOne<SleepRecord>(
    `UPDATE sleep_records
     SET date = $3, sleep_type = $4, bedtime = $5, wake_time = $6,
         duration_minutes = $7, tags = $8::text[], memo = $9
     WHERE id = $1 AND user_id = $2
     RETURNING ${SLEEP_RECORD_RETURNING}`,
    [
      id,
      userId,
      input.date,
      input.sleep_type,
      input.bedtime,
      input.wake_time,
      computeDurationMinutes(input.bedtime, input.wake_time),
      input.tags ?? [],
      input.memo ?? null,
    ],
  );
}

/** 수면 기록 삭제 (user 스코프) */
export async function deleteSleepRecord(userId: number, id: number): Promise<boolean> {
  const result = await query('DELETE FROM sleep_records WHERE id = $1 AND user_id = $2', [
    id,
    userId,
  ]);
  return (result.rowCount ?? 0) > 0;
}

/** 중간기상 이벤트 추가 */
export async function createSleepEvent(
  userId: number,
  input: SleepEventInput,
): Promise<SleepEvent> {
  const row = await queryOne<SleepEvent>(
    `INSERT INTO sleep_events (user_id, date, event_time, memo)
     VALUES ($1, $2, $3, $4)
     RETURNING id, date::text, event_time, memo`,
    [userId, input.date, input.event_time, input.memo ?? null],
  );
  if (!row) throw new Error('createSleepEvent: INSERT returned no rows');
  return row;
}

/** 중간기상 이벤트 삭제 (user 스코프) */
export async function deleteSleepEvent(userId: number, id: number): Promise<boolean> {
  const result = await query('DELETE FROM sleep_events WHERE id = $1 AND user_id = $2', [
    id,
    userId,
  ]);
  return (result.rowCount ?? 0) > 0;
}
