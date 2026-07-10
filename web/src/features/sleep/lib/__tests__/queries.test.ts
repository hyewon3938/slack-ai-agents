import { describe, it, expect } from 'vitest';

import { buildDailySleeps, calculateSleepSummary } from '../queries';
import type { DailySleep, SleepEvent, SleepRecordWithEvents } from '../types';

// ─── 합성 픽스처 (실제 개인 데이터 아님) ───────────────────────────────

function ev(id: number, date: string, eventTime: string): SleepEvent {
  return { id, date, event_time: eventTime, memo: null };
}

function night(
  id: number,
  date: string,
  bedtime: string | null,
  durationMinutes: number | null,
  wakeTime: string | null = null,
  events: SleepEvent[] = [],
): SleepRecordWithEvents {
  return {
    id,
    date,
    bedtime,
    wake_time: wakeTime,
    duration_minutes: durationMinutes,
    sleep_type: 'night',
    memo: null,
    tags: [],
    events,
  };
}

function nap(
  id: number,
  date: string,
  bedtime: string,
  durationMinutes: number | null,
  wakeTime: string | null = null,
): SleepRecordWithEvents {
  return {
    id,
    date,
    bedtime,
    wake_time: wakeTime,
    duration_minutes: durationMinutes,
    sleep_type: 'nap',
    memo: null,
    tags: [],
    events: [],
  };
}

function dailyOf(dailies: DailySleep[], date: string): DailySleep {
  const found = dailies.find((d) => d.date === date);
  if (!found) throw new Error(`daily 없음: ${date}`);
  return found;
}

describe('buildDailySleeps — 세그먼트 합성', () => {
  it('단일 세그먼트: waso 0, frag = 이벤트 수', () => {
    const e1 = ev(11, '2026-07-01', '03:10');
    const rec = night(1, '2026-07-01', '23:30', 480, '07:30', [e1]);

    const d = dailyOf(buildDailySleeps([rec], '2026-07-01', '2026-07-01'), '2026-07-01');

    expect(d.nightSegments).toHaveLength(1);
    expect(d.wasoMinutes).toBe(0);
    expect(d.timeInBedMinutes).toBe(480);
    expect(d.totalNightDurationMinutes).toBe(480);
    expect(d.fragmentationCount).toBe(1); // 이벤트 1 + (세그먼트 1 − 1)
    expect(d.effectiveWakeTime).toBe('07:30');
    expect(d.nightEvents).toEqual([e1]);
  });

  it('2세그먼트 00:30-03:00 + 03:45-09:00 → waso 45, timeInBed 510, totalNight 465, frag = 이벤트+1', () => {
    const e1 = ev(21, '2026-07-02', '03:20');
    // 현재 쿼리 함수는 같은 날 night 레코드마다 동일 events를 붙임 — 그 형태 재현
    const s1 = night(2, '2026-07-02', '00:30', 150, '03:00', [e1]);
    const s2 = night(3, '2026-07-02', '03:45', 315, '09:00', [e1]);

    const d = dailyOf(buildDailySleeps([s1, s2], '2026-07-02', '2026-07-02'), '2026-07-02');

    expect(d.nightSegments.map((s) => s.id)).toEqual([2, 3]);
    expect(d.wasoMinutes).toBe(45);
    expect(d.timeInBedMinutes).toBe(510);
    expect(d.totalNightDurationMinutes).toBe(465);
    expect(d.nightEvents).toHaveLength(1); // id dedup
    expect(d.fragmentationCount).toBe(2); // 이벤트 1 + (세그먼트 2 − 1)
    expect(d.effectiveWakeTime).toBe('09:00');
  });

  it('입력이 역순이어도 래핑 취침시각 기준 오름차순 정렬', () => {
    const s1 = night(2, '2026-07-02', '00:30', 150, '03:00');
    const s2 = night(3, '2026-07-02', '03:45', 315, '09:00');

    const d = dailyOf(buildDailySleeps([s2, s1], '2026-07-02', '2026-07-02'), '2026-07-02');

    expect(d.nightSegments.map((s) => s.id)).toEqual([2, 3]);
    expect(d.wasoMinutes).toBe(45);
    expect(d.timeInBedMinutes).toBe(510);
  });

  it('23:00 시작 세그먼트 + 새벽 세그먼트 → 래핑 정렬·계산 (23:00-01:00 + 01:30-06:30)', () => {
    const sA = night(4, '2026-07-03', '23:00', 120, '01:00');
    const sB = night(5, '2026-07-03', '01:30', 300, null); // wake 없음 → 종료 환산

    const d = dailyOf(buildDailySleeps([sB, sA], '2026-07-03', '2026-07-03'), '2026-07-03');

    expect(d.nightSegments.map((s) => s.id)).toEqual([4, 5]); // -60 < 90
    expect(d.wasoMinutes).toBe(30);
    expect(d.timeInBedMinutes).toBe(450);
    expect(d.totalNightDurationMinutes).toBe(420);
    expect(d.effectiveWakeTime).toBe('06:30'); // 01:30 + 300분 환산 (우선순위 ③)
  });

  it('bedtime NULL 밤잠은 메모 전용으로 분류 — 세그먼트 수학 미포함', () => {
    const e1 = ev(31, '2026-07-04', '02:00');
    const memo = night(6, '2026-07-04', null, 300, '09:00', [e1]);

    const d = dailyOf(buildDailySleeps([memo], '2026-07-04', '2026-07-04'), '2026-07-04');

    expect(d.nightSegments).toHaveLength(0);
    expect(d.nightMemoRecords.map((r) => r.id)).toEqual([6]);
    expect(d.totalNightDurationMinutes).toBe(0); // duration 300이어도 미포함
    expect(d.timeInBedMinutes).toBe(0);
    expect(d.wasoMinutes).toBe(0);
    expect(d.effectiveWakeTime).toBeNull(); // 메모 레코드 wake_time 미사용
    expect(d.nightEvents).toEqual([e1]); // 이벤트는 date 레벨로 승격
    expect(d.fragmentationCount).toBe(1);
  });

  it('duration NULL 세그먼트 방어: 종료 = 시작으로 간주, NaN 없음', () => {
    const s1 = night(7, '2026-07-05', '01:00', null);
    const s2 = night(8, '2026-07-05', '02:00', 60, null);

    const d = dailyOf(buildDailySleeps([s1, s2], '2026-07-05', '2026-07-05'), '2026-07-05');

    expect(d.wasoMinutes).toBe(60); // 01:00(종료 01:00) → 02:00 갭
    expect(d.timeInBedMinutes).toBe(120);
    expect(d.totalNightDurationMinutes).toBe(60);
    expect(d.effectiveWakeTime).toBe('03:00'); // 마지막 세그먼트 02:00 + 60분
  });

  it('아침잠 합산 + effectiveWakeTime 우선순위 ①(아침잠 최후 wake) 회귀', () => {
    const n = night(9, '2026-07-06', '23:00', 360, '05:00');
    const morning = nap(10, '2026-07-06', '08:00', 90, '09:30');
    const afternoon = nap(11, '2026-07-06', '14:00', 30, '14:30');

    const d = dailyOf(
      buildDailySleeps([n, morning, afternoon], '2026-07-06', '2026-07-06'),
      '2026-07-06',
    );

    expect(d.totalNightDurationMinutes).toBe(450); // 밤잠 360 + 아침잠 90 (낮잠 제외)
    expect(d.effectiveWakeTime).toBe('09:30'); // 세그먼트 wake(05:00)보다 아침잠 우선
    expect(d.morningSleeps.map((r) => r.id)).toEqual([10]);
    expect(d.afternoonNaps.map((r) => r.id)).toEqual([11]);
  });

  it('nightEvents는 id 기준 dedup + event_time 오름차순', () => {
    const e1 = ev(81, '2026-07-07', '04:00');
    const e2 = ev(82, '2026-07-07', '01:00');
    const s1 = night(12, '2026-07-07', '23:00', 60, null, [e1, e2]);
    const s2 = night(13, '2026-07-07', '01:00', 120, null, [e1, e2]);

    const d = dailyOf(buildDailySleeps([s1, s2], '2026-07-07', '2026-07-07'), '2026-07-07');

    expect(d.nightEvents.map((e) => e.id)).toEqual([82, 81]); // 01:00 → 04:00
    expect(d.fragmentationCount).toBe(3); // 이벤트 2 + (세그먼트 2 − 1)
  });
});

describe('calculateSleepSummary — 분할 수면 반영', () => {
  it('2세그먼트 하루: avgWaso·avgEfficiency·totalMidWakes·onset 기준 avgBedtime', () => {
    const e1 = ev(21, '2026-07-02', '03:20');
    const s1 = night(2, '2026-07-02', '00:30', 150, '03:00', [e1]);
    const s2 = night(3, '2026-07-02', '03:45', 315, '09:00', [e1]);

    const summary = calculateSleepSummary(buildDailySleeps([s1, s2], '2026-07-02', '2026-07-02'));

    expect(summary.totalNights).toBe(1);
    expect(summary.avgDuration).toBe(465);
    expect(summary.avgBedtime).toBe('00:30'); // 첫 세그먼트 onset
    expect(summary.avgWakeTime).toBe('09:00');
    expect(summary.totalMidWakes).toBe(1); // dedup된 date 레벨 이벤트
    expect(summary.avgWasoMinutes).toBe(45);
    expect(summary.avgEfficiencyPct).toBe(91); // 465/510 ≈ 91.2%
    expect(summary.scores).not.toBeNull();
    expect(summary.scores?.duration).toBe(100); // 465분은 목표 구간 안
  });

  it('수면 기록 없는 기간: scores null, avgEfficiencyPct null, avgWasoMinutes 0', () => {
    const summary = calculateSleepSummary(buildDailySleeps([], '2026-07-01', '2026-07-03'));

    expect(summary.totalNights).toBe(0);
    expect(summary.scores).toBeNull();
    expect(summary.avgEfficiencyPct).toBeNull();
    expect(summary.avgWasoMinutes).toBe(0);
    expect(summary.avgBedtime).toBe('--:--');
  });
});
