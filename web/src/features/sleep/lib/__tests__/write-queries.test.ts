import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

import { query, queryOne } from '@/lib/db';
import type { QueryResult } from '@/lib/db';
import {
  computeDurationMinutes,
  createSleepRecord,
  updateSleepRecord,
  deleteSleepRecord,
  createSleepEvent,
  deleteSleepEvent,
} from '../queries';

// ─── 합성 픽스처 (실제 개인 데이터 아님) ───────────────────────────────
// DB proxy는 fetch 기반이라 목킹 불가 → @/lib/db의 query/queryOne을 스텁하고
// 생성된 SQL·파라미터 배열(user_id 스코프·서버 계산된 duration)을 검증한다.

const RECORD_ROW: Record<string, unknown> = {
  id: 1,
  date: '2026-07-11',
  bedtime: '23:30',
  wake_time: '07:30',
  duration_minutes: 480,
  sleep_type: 'night',
  memo: null,
  tags: [],
};

const EVENT_ROW: Record<string, unknown> = {
  id: 1,
  date: '2026-07-11',
  event_time: '03:20',
  memo: null,
};

const okDelete: QueryResult = { rows: [], rowCount: 1 };
const noDelete: QueryResult = { rows: [], rowCount: 0 };

function lastQueryOneCall(): [string, unknown[]] {
  const call = vi.mocked(queryOne).mock.calls.at(-1);
  if (!call) throw new Error('queryOne 미호출');
  return [call[0], (call[1] ?? []) as unknown[]];
}

function lastQueryCall(): [string, unknown[]] {
  const call = vi.mocked(query).mock.calls.at(-1);
  if (!call) throw new Error('query 미호출');
  return [call[0], (call[1] ?? []) as unknown[]];
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ─── duration 계산 (순수 함수) — #600 회귀 방어 ────────────────────────
// 이 로직은 원래 SQL 표현식이었는데, bedtime 파라미터가 text(`bedtime = $n`)와
// time(`$n::time`) 두 컨텍스트로 쓰여 "inconsistent types deduced for parameter"
// 500을 냈다. TS 순수 함수로 옮겨 파라미터 타입 충돌을 제거하고, 여기서 직접 검증한다.
describe('computeDurationMinutes — 서버 계산 (#600)', () => {
  it('같은 날 구간: 23:30→07:30 = 480분', () => {
    expect(computeDurationMinutes('23:30', '07:30')).toBe(480);
  });

  it('자정 넘김: 23:00→07:00 = 480분', () => {
    expect(computeDurationMinutes('23:00', '07:00')).toBe(480);
  });

  it('새벽 취침(자정 이후): 02:50→10:30 = 460분 (실패 재현 케이스)', () => {
    expect(computeDurationMinutes('02:50', '10:30')).toBe(460);
  });

  it('낮잠 짧은 구간: 13:00→13:30 = 30분', () => {
    expect(computeDurationMinutes('13:00', '13:30')).toBe(30);
  });

  it('00:15→08:00 = 465분', () => {
    expect(computeDurationMinutes('00:15', '08:00')).toBe(465);
  });

  it('한쪽이라도 null이면 null', () => {
    expect(computeDurationMinutes(null, '07:00')).toBeNull();
    expect(computeDurationMinutes('23:00', null)).toBeNull();
    expect(computeDurationMinutes(null, null)).toBeNull();
  });
});

describe('createSleepRecord — INSERT SQL·파라미터·서버 계산 duration', () => {
  it('night(취침·기상 모두): user_id 선두 + duration은 계산된 정수 파라미터', async () => {
    vi.mocked(queryOne).mockResolvedValue(RECORD_ROW);

    const result = await createSleepRecord(7, {
      date: '2026-07-11',
      sleep_type: 'night',
      bedtime: '23:30',
      wake_time: '07:30',
      tags: ['카페인'],
      memo: '늦게 잠들었다',
    });

    expect(result).toBe(RECORD_ROW);
    expect(queryOne).toHaveBeenCalledTimes(1);

    const [sql, params] = lastQueryOneCall();
    expect(sql).toContain('INSERT INTO sleep_records');
    // duration은 파라미터($6)로 전달 — SQL time 캐스트 없음(파라미터 타입 충돌 방지 #600)
    expect(sql).not.toContain('::time');
    expect(sql).not.toContain('EXTRACT(EPOCH');
    expect(sql).toContain('$7::text[]'); // tags는 명시적 text[] 캐스팅

    // user_id 선두 + date·type·bed·wake·**duration(계산값)**·tags·memo
    expect(params).toEqual([
      7,
      '2026-07-11',
      'night',
      '23:30',
      '07:30',
      480,
      ['카페인'],
      '늦게 잠들었다',
    ]);
    expect(params[0]).toBe(7);
  });

  it('nap: tags/memo 미지정 → tags 기본 [] + memo null, duration 계산', async () => {
    vi.mocked(queryOne).mockResolvedValue(RECORD_ROW);

    await createSleepRecord(7, {
      date: '2026-07-11',
      sleep_type: 'nap',
      bedtime: '13:00',
      wake_time: '13:30',
    });

    const [sql, params] = lastQueryOneCall();
    expect(sql).toContain('INSERT INTO sleep_records');
    expect(params).toEqual([7, '2026-07-11', 'nap', '13:00', '13:30', 30, [], null]);
  });

  it('bedtime·wake_time NULL(메모 전용 밤잠): duration은 null 파라미터', async () => {
    vi.mocked(queryOne).mockResolvedValue(RECORD_ROW);

    await createSleepRecord(7, {
      date: '2026-07-11',
      sleep_type: 'night',
      bedtime: null,
      wake_time: null,
      memo: '시간 기억 안 남',
    });

    const [, params] = lastQueryOneCall();
    expect(params).toEqual([7, '2026-07-11', 'night', null, null, null, [], '시간 기억 안 남']);
  });
});

describe('updateSleepRecord — UPDATE SQL·user_id 스코프·duration 재계산', () => {
  it('전체 필드 교체 + duration 재계산(파라미터) + WHERE id·user_id', async () => {
    vi.mocked(queryOne).mockResolvedValue(RECORD_ROW);

    await updateSleepRecord(7, 42, {
      date: '2026-07-12',
      sleep_type: 'night',
      bedtime: '00:15',
      wake_time: '08:00',
      tags: [],
      memo: null,
    });

    const [sql, params] = lastQueryOneCall();
    expect(sql).toContain('UPDATE sleep_records');
    expect(sql).toContain('WHERE id = $1 AND user_id = $2');
    expect(sql).not.toContain('::time');
    expect(sql).toContain('duration_minutes = $7');
    expect(sql).toContain('$8::text[]');

    // id·user_id 선두 + date·type·bed·wake·**duration(465)**·tags·memo
    expect(params).toEqual([42, 7, '2026-07-12', 'night', '00:15', '08:00', 465, [], null]);
  });

  it('대상 없음(queryOne null) → null 반환', async () => {
    vi.mocked(queryOne).mockResolvedValue(null);

    const result = await updateSleepRecord(7, 999, {
      date: '2026-07-12',
      sleep_type: 'night',
      bedtime: '23:00',
      wake_time: '06:00',
    });

    expect(result).toBeNull();
  });
});

describe('deleteSleepRecord — user_id 스코프 + rowCount 판정', () => {
  it('rowCount>0 → true, WHERE id·user_id + 파라미터 [id, userId]', async () => {
    vi.mocked(query).mockResolvedValue(okDelete);

    const ok = await deleteSleepRecord(7, 42);

    expect(ok).toBe(true);
    const [sql, params] = lastQueryCall();
    expect(sql).toContain('DELETE FROM sleep_records');
    expect(sql).toContain('WHERE id = $1 AND user_id = $2');
    expect(params).toEqual([42, 7]);
  });

  it('rowCount 0(타 유저 행이라 매칭 실패) → false', async () => {
    vi.mocked(query).mockResolvedValue(noDelete);

    expect(await deleteSleepRecord(7, 42)).toBe(false);
  });
});

describe('sleep_events 쓰기 — user_id 스코프', () => {
  it('createSleepEvent: user_id 선두 + INSERT INTO sleep_events', async () => {
    vi.mocked(queryOne).mockResolvedValue(EVENT_ROW);

    const result = await createSleepEvent(7, {
      date: '2026-07-11',
      event_time: '03:20',
      memo: '화장실',
    });

    expect(result).toBe(EVENT_ROW);
    const [sql, params] = lastQueryOneCall();
    expect(sql).toContain('INSERT INTO sleep_events');
    expect(params).toEqual([7, '2026-07-11', '03:20', '화장실']);
  });

  it('deleteSleepEvent: WHERE id·user_id + 파라미터 [id, userId]', async () => {
    vi.mocked(query).mockResolvedValue(okDelete);

    const ok = await deleteSleepEvent(7, 5);

    expect(ok).toBe(true);
    const [sql, params] = lastQueryCall();
    expect(sql).toContain('DELETE FROM sleep_events');
    expect(sql).toContain('WHERE id = $1 AND user_id = $2');
    expect(params).toEqual([5, 7]);
  });
});
