import { describe, it, expect } from 'vitest';

import { calculateSleepScores } from '../scores';
import type { DailySleep, SleepRecordWithEvents } from '../types';

// ─── 합성 픽스처 (실제 개인 데이터 아님) ───────────────────────────────

function seg(
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
    sleep_type: 'night',
    memo: null,
    events: [],
  };
}

function makeDaily(date: string, over: Partial<DailySleep> = {}): DailySleep {
  return {
    date,
    nightSegments: [],
    nightMemoRecords: [],
    nightEvents: [],
    morningSleeps: [],
    afternoonNaps: [],
    totalNightDurationMinutes: 0,
    effectiveWakeTime: null,
    wasoMinutes: 0,
    timeInBedMinutes: 0,
    fragmentationCount: 0,
    ...over,
  };
}

/** 단일 세그먼트 하루 — bedtime·duration만 지정, 나머지는 over로 */
function nightDay(
  date: string,
  bedtime: string,
  durationMinutes: number,
  over: Partial<DailySleep> = {},
): DailySleep {
  return makeDaily(date, {
    nightSegments: [seg(1, date, bedtime, durationMinutes)],
    totalNightDurationMinutes: durationMinutes,
    ...over,
  });
}

describe('calculateSleepScores — duration 축', () => {
  it('목표 구간 안(480분)이면 100', () => {
    const s = calculateSleepScores([nightDay('2026-07-01', '23:30', 480)]);
    expect(s?.duration).toBe(100);
  });

  it('경계값 420·540분도 100', () => {
    const s = calculateSleepScores([
      nightDay('2026-07-01', '23:30', 420),
      nightDay('2026-07-02', '23:30', 540),
    ]);
    expect(s?.duration).toBe(100);
  });

  it('목표 미달 30분 → 선형 감점 (83.33…)', () => {
    const s = calculateSleepScores([nightDay('2026-07-01', '23:30', 390)]);
    expect(s?.duration).toBeCloseTo(83.3333, 3);
  });

  it('초과 방향도 동일 감점 (600분 → 66.67)', () => {
    const s = calculateSleepScores([nightDay('2026-07-01', '23:30', 600)]);
    expect(s?.duration).toBeCloseTo(66.6667, 3);
  });

  it('편차 180분 이상이면 0으로 clamp (240분·60분 모두 0)', () => {
    const s = calculateSleepScores([
      nightDay('2026-07-01', '23:30', 240),
      nightDay('2026-07-02', '23:30', 60),
    ]);
    expect(s?.duration).toBe(0);
  });

  it('수기 상수 검증: 330분 → 정확히 50 (zeroAtDeviationMinutes=180 기준 — 상수 바뀌면 이 값도 바뀜)', () => {
    const s = calculateSleepScores([nightDay('2026-07-01', '23:00', 330)]);
    expect(s?.duration).toBe(50);
  });
});

describe('calculateSleepScores — 밤잠 데이터 없음', () => {
  it('duration 대상 0일이면 전체 null (빈 하루 + 메모 전용 하루)', () => {
    const memoDay = makeDaily('2026-07-02', {
      nightMemoRecords: [
        {
          id: 9,
          date: '2026-07-02',
          bedtime: null,
          wake_time: null,
          duration_minutes: null,
          sleep_type: 'night',
          memo: '늦게 잠',
          events: [],
        },
      ],
    });
    expect(calculateSleepScores([makeDaily('2026-07-01'), memoDay])).toBeNull();
  });

  it('빈 배열도 null', () => {
    expect(calculateSleepScores([])).toBeNull();
  });
});

describe('calculateSleepScores — timing 축 (래핑)', () => {
  it('23:30 취침(자정 전)은 late 0 → 100', () => {
    const s = calculateSleepScores([nightDay('2026-07-01', '23:30', 480)]);
    expect(s?.timing).toBe(100);
  });

  it('00:30 취침은 late 30분 → 83.33…', () => {
    const s = calculateSleepScores([nightDay('2026-07-01', '00:30', 480)]);
    expect(s?.timing).toBeCloseTo(83.3333, 3);
  });

  it('03:00 취침(late 180분)이면 0으로 clamp', () => {
    const s = calculateSleepScores([nightDay('2026-07-01', '03:00', 480)]);
    expect(s?.timing).toBe(0);
  });
});

describe('calculateSleepScores — regularity 축', () => {
  it('취침·기상 표본 각 1일 → regularity null, total은 나머지 3축 가중치 재정규화 (수기 82)', () => {
    // duration 100, timing 66.67(late 60), continuity 66.67(frag 1)
    // total = (0.35*100 + 0.2*66.67 + 0.2*66.67) / 0.75 = 82.22 → 82
    const s = calculateSleepScores([
      nightDay('2026-07-01', '01:00', 480, { effectiveWakeTime: '09:00', fragmentationCount: 1 }),
    ]);
    expect(s?.regularity).toBeNull();
    expect(s?.total).toBe(82);
  });

  it('취침 표본만 ≥ 2 → 취침 측 표준편차만 사용 (std 60 → 50)', () => {
    const s = calculateSleepScores([
      nightDay('2026-07-01', '23:00', 480),
      nightDay('2026-07-02', '01:00', 480),
    ]);
    expect(s?.regularity).toBe(50);
  });

  it('취침·기상 둘 다 ≥ 2 → 두 측 점수 평균 (100과 75 → 87.5)', () => {
    const s = calculateSleepScores([
      nightDay('2026-07-01', '00:00', 480, { effectiveWakeTime: '08:00' }),
      nightDay('2026-07-02', '00:00', 480, { effectiveWakeTime: '09:00' }),
    ]);
    expect(s?.regularity).toBe(87.5);
  });
});

describe('calculateSleepScores — continuity 축', () => {
  it('밤당 평균 분절 1.5 → 50', () => {
    const s = calculateSleepScores([
      nightDay('2026-07-01', '23:30', 480, { fragmentationCount: 0 }),
      nightDay('2026-07-02', '23:30', 480, { fragmentationCount: 3 }),
    ]);
    expect(s?.continuity).toBe(50);
  });

  it('분절 수가 기준(3/밤) 이상이면 0으로 clamp', () => {
    const s = calculateSleepScores([
      nightDay('2026-07-01', '23:30', 480, { fragmentationCount: 9 }),
    ]);
    expect(s?.continuity).toBe(0);
  });
});

describe('calculateSleepScores — total (4축 가중 평균)', () => {
  it('수기 계산 값과 일치 (duration 50 / regularity 75 / continuity 50 / timing 66.67 → 60)', () => {
    // 0.35*50 + 0.25*75 + 0.2*50 + 0.2*66.67 = 59.58 → 60
    const s = calculateSleepScores([
      nightDay('2026-07-01', '00:00', 420, { effectiveWakeTime: '08:00', fragmentationCount: 0 }),
      nightDay('2026-07-02', '02:00', 240, { effectiveWakeTime: '08:00', fragmentationCount: 3 }),
    ]);
    expect(s?.duration).toBe(50);
    expect(s?.regularity).toBe(75);
    expect(s?.continuity).toBe(50);
    expect(s?.timing).toBeCloseTo(66.6667, 3);
    expect(s?.total).toBe(60);
  });
});
