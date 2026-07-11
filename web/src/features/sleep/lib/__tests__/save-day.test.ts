import { describe, it, expect, vi } from 'vitest';

import { saveSleepDay, type SleepDayMutations, type SleepDayDraft } from '../save-day';
import type { DailySleep, SleepRecordWithEvents, SleepEvent, SleepRecordInput } from '../types';

// ─── 합성 픽스처 (실제 개인 데이터 아님) ───────────────────────────────

function nightRec(id: number, bedtime = '00:30'): SleepRecordWithEvents {
  return {
    id,
    date: '2026-07-11',
    bedtime,
    wake_time: '09:30',
    duration_minutes: 540,
    sleep_type: 'night',
    memo: null,
    tags: [],
    events: [],
  };
}

function midWakeEvent(id: number, eventTime = '03:00'): SleepEvent {
  return { id, date: '2026-07-11', event_time: eventTime, memo: null };
}

function daily(over: Partial<DailySleep> = {}): DailySleep {
  return {
    date: '2026-07-11',
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

function nightPayload(over: Partial<SleepRecordInput> = {}): SleepRecordInput {
  return {
    date: '2026-07-11',
    sleep_type: 'night',
    bedtime: '00:30',
    wake_time: '09:30',
    tags: [],
    memo: null,
    ...over,
  };
}

function draftOf(over: Partial<SleepDayDraft> = {}): SleepDayDraft {
  return { date: '2026-07-11', nightPayloads: [], napPayloads: [], midWakeTimes: [], ...over };
}

/** 호출 순서를 기록하는 mock mutation 묶음. failOn 지정 시 해당 op에서 throw */
function makeMutations(failOn?: keyof SleepDayMutations): {
  m: SleepDayMutations;
  calls: string[];
} {
  const calls: string[] = [];
  const record = (name: keyof SleepDayMutations): void => {
    calls.push(name);
    if (name === failOn) throw new Error(`mutation failed: ${name}`);
  };
  const m: SleepDayMutations = {
    createRecord: vi.fn(async (_input: SleepRecordInput) => record('createRecord')),
    updateRecord: vi.fn(async (_id: number, _input: SleepRecordInput) => record('updateRecord')),
    deleteRecord: vi.fn(async (_id: number) => record('deleteRecord')),
    createEvent: vi.fn(async (_input: { date: string; event_time: string }) =>
      record('createEvent'),
    ),
    deleteEvent: vi.fn(async (_id: number) => record('deleteEvent')),
  };
  return { m, calls };
}

describe('saveSleepDay — 데이터 손실 방지 (#598)', () => {
  it('편집 중 upsert 실패 시 파괴적 삭제를 절대 호출하지 않는다', async () => {
    const { m, calls } = makeMutations('updateRecord');
    const existing = daily({ nightSegments: [nightRec(100)] });

    await expect(
      saveSleepDay(existing, draftOf({ nightPayloads: [nightPayload({ tags: ['악몽'] })] }), m),
    ).rejects.toThrow();

    expect(m.deleteRecord).not.toHaveBeenCalled();
    expect(m.deleteEvent).not.toHaveBeenCalled();
    expect(calls).toEqual(['updateRecord']); // 삭제 단계 도달 X → 기존 데이터 보존
  });

  it('태그만 추가하는 흔한 경우: 단일 UPDATE, 생성·삭제 없음', async () => {
    const { m } = makeMutations();
    const existing = daily({ nightSegments: [nightRec(100)] });

    await saveSleepDay(existing, draftOf({ nightPayloads: [nightPayload({ tags: ['악몽'] })] }), m);

    expect(m.updateRecord).toHaveBeenCalledTimes(1);
    expect(m.updateRecord).toHaveBeenCalledWith(100, expect.objectContaining({ tags: ['악몽'] }));
    expect(m.createRecord).not.toHaveBeenCalled();
    expect(m.deleteRecord).not.toHaveBeenCalled();
  });

  it('구간 감소: 남는 레코드 UPDATE 후 초과분 삭제 — 삭제는 upsert 뒤에만', async () => {
    const { m, calls } = makeMutations();
    const existing = daily({
      nightSegments: [nightRec(100, '00:30'), nightRec(101, '03:45')],
    });

    await saveSleepDay(existing, draftOf({ nightPayloads: [nightPayload()] }), m);

    expect(m.updateRecord).toHaveBeenCalledTimes(1);
    expect(m.deleteRecord).toHaveBeenCalledTimes(1);
    expect(m.deleteRecord).toHaveBeenCalledWith(101);
    expect(calls.indexOf('deleteRecord')).toBeGreaterThan(calls.indexOf('updateRecord'));
  });

  it('구간 증가: 기존 UPDATE + 새 구간 INSERT, 삭제 없음', async () => {
    const { m } = makeMutations();
    const existing = daily({ nightSegments: [nightRec(100)] });

    await saveSleepDay(
      existing,
      draftOf({ nightPayloads: [nightPayload(), nightPayload({ bedtime: '03:45' })] }),
      m,
    );

    expect(m.updateRecord).toHaveBeenCalledTimes(1);
    expect(m.createRecord).toHaveBeenCalledTimes(1);
    expect(m.deleteRecord).not.toHaveBeenCalled();
  });

  it('추가 모드(existing=null): 전부 생성, update·delete 없음', async () => {
    const { m } = makeMutations();

    await saveSleepDay(
      null,
      draftOf({ nightPayloads: [nightPayload()], midWakeTimes: ['03:20'] }),
      m,
    );

    expect(m.createRecord).toHaveBeenCalledTimes(1);
    expect(m.createEvent).toHaveBeenCalledTimes(1);
    expect(m.updateRecord).not.toHaveBeenCalled();
    expect(m.deleteRecord).not.toHaveBeenCalled();
  });

  it('이벤트 재조정: 새 이벤트 생성이 기존 이벤트 삭제보다 먼저', async () => {
    const { m, calls } = makeMutations();
    const existing = daily({
      nightSegments: [nightRec(100)],
      nightEvents: [midWakeEvent(200)],
    });

    await saveSleepDay(
      existing,
      draftOf({ nightPayloads: [nightPayload()], midWakeTimes: ['04:00'] }),
      m,
    );

    expect(calls.indexOf('createEvent')).toBeLessThan(calls.indexOf('deleteEvent'));
  });

  it('낮잠 포함 편집: 밤잠·낮잠 각각 위치 매칭', async () => {
    const { m } = makeMutations();
    const existing = daily({
      nightSegments: [nightRec(100)],
      afternoonNaps: [
        { ...nightRec(300), sleep_type: 'nap', bedtime: '14:00', wake_time: '15:00' },
      ],
    });

    await saveSleepDay(
      existing,
      draftOf({
        nightPayloads: [nightPayload()],
        napPayloads: [nightPayload({ sleep_type: 'nap', bedtime: '14:00', wake_time: '15:00' })],
      }),
      m,
    );

    expect(m.updateRecord).toHaveBeenCalledWith(
      100,
      expect.objectContaining({ sleep_type: 'night' }),
    );
    expect(m.updateRecord).toHaveBeenCalledWith(
      300,
      expect.objectContaining({ sleep_type: 'nap' }),
    );
    expect(m.deleteRecord).not.toHaveBeenCalled();
  });
});
