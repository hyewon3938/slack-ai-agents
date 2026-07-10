import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

import { query, queryOne } from '@/lib/db';
import type { QueryResult } from '@/lib/db';
import {
  createSleepRecord,
  updateSleepRecord,
  deleteSleepRecord,
  createSleepEvent,
  deleteSleepEvent,
} from '../queries';

// ─── 합성 픽스처 (실제 개인 데이터 아님) ───────────────────────────────
// DB proxy는 fetch 기반이라 목킹 불가 → @/lib/db의 query/queryOne을 스텁하고
// 생성된 SQL 조각(duration 공식·user_id 스코프)과 파라미터 배열 구성을 검증한다.

/** queryOne이 돌려줄 합성 행 (RETURNING 결과 대역, 내용은 assert에 안 씀) */
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

/** queryOne 마지막 호출의 [sql, params] */
function lastQueryOneCall(): [string, unknown[]] {
  const call = vi.mocked(queryOne).mock.calls.at(-1);
  if (!call) throw new Error('queryOne 미호출');
  return [call[0], (call[1] ?? []) as unknown[]];
}

/** query 마지막 호출의 [sql, params] */
function lastQueryCall(): [string, unknown[]] {
  const call = vi.mocked(query).mock.calls.at(-1);
  if (!call) throw new Error('query 미호출');
  return [call[0], (call[1] ?? []) as unknown[]];
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('createSleepRecord — INSERT SQL·파라미터·duration 공식', () => {
  it('night(취침·기상 모두): user_id 선두 + duration 공식(자정 넘김·EXTRACT·% 1440)', async () => {
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
    // duration은 암산이 아니라 SQL에서 계산 — 공식 조각이 실제로 들어갔는지 고정
    expect(sql).toContain('EXTRACT(EPOCH FROM');
    expect(sql).toContain("INTERVAL '24h'");
    expect(sql).toContain('% 1440');
    // bedtime·wake_time 둘 다 있을 때만 계산하는 가드
    expect(sql).toContain('$4 IS NOT NULL AND $5 IS NOT NULL');
    // tags는 명시적 text[] 캐스팅
    expect(sql).toContain('$6::text[]');

    // 파라미터 순서: user_id 선두(스코프), 이후 date·type·bed·wake·tags·memo
    expect(params).toEqual([
      7,
      '2026-07-11',
      'night',
      '23:30',
      '07:30',
      ['카페인'],
      '늦게 잠들었다',
    ]);
    expect(params[0]).toBe(7);
  });

  it('nap: tags/memo 미지정 → tags 기본 [] + memo null 정규화', async () => {
    vi.mocked(queryOne).mockResolvedValue(RECORD_ROW);

    await createSleepRecord(7, {
      date: '2026-07-11',
      sleep_type: 'nap',
      bedtime: '13:00',
      wake_time: '13:30',
    });

    const [sql, params] = lastQueryOneCall();
    expect(sql).toContain('INSERT INTO sleep_records');
    expect(params).toEqual([7, '2026-07-11', 'nap', '13:00', '13:30', [], null]);
  });

  it('bedtime·wake_time NULL(메모 전용 밤잠): null 파라미터가 그대로 전달, CASE가 duration NULL 처리', async () => {
    vi.mocked(queryOne).mockResolvedValue(RECORD_ROW);

    await createSleepRecord(7, {
      date: '2026-07-11',
      sleep_type: 'night',
      bedtime: null,
      wake_time: null,
      memo: '시간 기억 안 남',
    });

    const [sql, params] = lastQueryOneCall();
    // duration은 CASE로 조건부 — 둘 다 NULL이면 SQL이 NULL 산출 (암산 아님)
    expect(sql).toMatch(/CASE\s+WHEN .* IS NOT NULL AND .* IS NOT NULL/s);
    expect(params[3]).toBeNull(); // bedtime
    expect(params[4]).toBeNull(); // wake_time
    expect(params).toEqual([7, '2026-07-11', 'night', null, null, [], '시간 기억 안 남']);
  });
});

describe('updateSleepRecord — UPDATE SQL·user_id 스코프·duration 재계산', () => {
  it('전체 필드 교체 + duration 재계산($5/$6) + WHERE id·user_id', async () => {
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
    expect(sql).toContain("INTERVAL '24h'");
    expect(sql).toContain('% 1440');
    // update의 duration 재계산은 $5(bedtime)·$6(wake_time) 참조
    expect(sql).toContain('$5 IS NOT NULL AND $6 IS NOT NULL');
    expect(sql).toContain('$7::text[]');

    // id·user_id가 파라미터 선두(스코프), 이후 date·type·bed·wake·tags·memo
    expect(params).toEqual([42, 7, '2026-07-12', 'night', '00:15', '08:00', [], null]);
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
