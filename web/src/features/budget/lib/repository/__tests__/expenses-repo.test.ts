import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
}));

import { query } from '@/lib/db';
import { readFlexibleSpent, readTodayFlexSpent } from '../expenses-repo';

// biome-ignore lint/suspicious/noExplicitAny: test mock convenience
type Any = any;

describe('readFlexibleSpent', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('planned_expense_id IS NULL 조건이 SQL에 포함되어야 함', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ total: '50000' }] } as Any);

    await readFlexibleSpent(1, '2026-03-16', '2026-04-15');

    expect(query).toHaveBeenCalledTimes(1);
    const sql = vi.mocked(query).mock.calls[0]![0] as string;
    expect(sql).toMatch(/planned_expense_id\s+IS\s+NULL/i);
  });

  it('예정지출 연결 건이 자유지출 합계에 포함되지 않아야 함', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ total: '30000' }] } as Any);

    const result = await readFlexibleSpent(1, '2026-03-16', '2026-04-15');

    expect(result).toBe(30000);
    // SQL이 planned_expense_id IS NULL을 포함하므로, 연결된 건은 이미 제외됨
    const sql = vi.mocked(query).mock.calls[0]![0] as string;
    expect(sql).toMatch(/planned_expense_id\s+IS\s+NULL/i);
  });

  it('기본 필터 조건: expense 타입, exclude_from_budget=false, is_installment=false', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ total: '0' }] } as Any);

    await readFlexibleSpent(1, '2026-03-16', '2026-04-15');

    const sql = vi.mocked(query).mock.calls[0]![0] as string;
    expect(sql).toMatch(/exclude_from_budget\s*=\s*false/i);
    expect(sql).toMatch(/is_installment\s*=\s*false/i);
    expect(sql).toMatch(/type.*expense/i);
  });
});

describe('readTodayFlexSpent', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('planned_expense_id IS NULL 조건이 SQL에 포함되어야 함', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ total: '15000' }] } as Any);

    await readTodayFlexSpent(1, '2026-04-10');

    expect(query).toHaveBeenCalledTimes(1);
    const sql = vi.mocked(query).mock.calls[0]![0] as string;
    expect(sql).toMatch(/planned_expense_id\s+IS\s+NULL/i);
  });

  it('예정지출 연결 건이 오늘 자유지출에 포함되지 않아야 함', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ total: '10000' }] } as Any);

    const result = await readTodayFlexSpent(1, '2026-04-10');

    expect(result).toBe(10000);
    const sql = vi.mocked(query).mock.calls[0]![0] as string;
    expect(sql).toMatch(/planned_expense_id\s+IS\s+NULL/i);
  });
});
