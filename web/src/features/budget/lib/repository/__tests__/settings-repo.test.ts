import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({ query: vi.fn() }));

import { query } from '@/lib/db';
import { readTargetMonth, upsertTargetDate } from '../settings-repo';

// biome-ignore lint/suspicious/noExplicitAny: test mock convenience
type Any = any;

const USER = 1;

describe('readTargetMonth', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('저장된 target_date 반환', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ target_date: '2026-08' }] } as Any);
    expect(await readTargetMonth(USER)).toBe('2026-08');
  });

  it('행 없으면 null', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as Any);
    expect(await readTargetMonth(USER)).toBeNull();
  });

  it('target_date가 null이면 null', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ target_date: null }] } as Any);
    expect(await readTargetMonth(USER)).toBeNull();
  });
});

describe('upsertTargetDate (#539 — 단순 upsert, 자산 보정 없음)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('ON CONFLICT upsert 한 번만 — 영향 분석·자산 보정 호출 없음', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as Any);

    await upsertTargetDate(USER, '2026-09');

    expect(query).toHaveBeenCalledTimes(1);
    const sql = vi.mocked(query).mock.calls[0]![0] as string;
    expect(sql).toMatch(/INSERT INTO budget_settings/i);
    expect(sql).toMatch(/ON CONFLICT/i);
    expect(vi.mocked(query).mock.calls[0]![1]).toEqual([USER, '2026-09']);
  });

  it('null 저장 가능 (목표 해제)', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as Any);

    await upsertTargetDate(USER, null);

    expect(vi.mocked(query).mock.calls[0]![1]).toEqual([USER, null]);
  });
});
