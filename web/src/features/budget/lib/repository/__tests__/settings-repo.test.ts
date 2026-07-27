import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('@/lib/db', () => ({ query: vi.fn() }));

import { query } from '@/lib/db';
import { readTargetMonth, upsertTargetDate } from '../settings-repo';

// vi.mocked()는 실제 시그니처(QueryResult)를 요구해서 부분 목 객체를 넘길 수 없다.
// 목 핸들을 여기서 한 번만 느슨하게 잡고, 각 케이스에서는 캐스팅 없이 쓴다.
const mockQuery = query as unknown as Mock;

const USER = 1;

describe('readTargetMonth', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('저장된 target_date 반환', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ target_date: '2026-08' }] });
    expect(await readTargetMonth(USER)).toBe('2026-08');
  });

  it('행 없으면 null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await readTargetMonth(USER)).toBeNull();
  });

  it('target_date가 null이면 null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ target_date: null }] });
    expect(await readTargetMonth(USER)).toBeNull();
  });
});

describe('upsertTargetDate (#539 — 단순 upsert, 자산 보정 없음)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('ON CONFLICT upsert 한 번만 — 영향 분석·자산 보정 호출 없음', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await upsertTargetDate(USER, '2026-09');

    expect(query).toHaveBeenCalledTimes(1);
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toMatch(/INSERT INTO budget_settings/i);
    expect(sql).toMatch(/ON CONFLICT/i);
    expect(mockQuery.mock.calls[0]![1]).toEqual([USER, '2026-09']);
  });

  it('null 저장 가능 (목표 해제)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await upsertTargetDate(USER, null);

    expect(mockQuery.mock.calls[0]![1]).toEqual([USER, null]);
  });
});
