import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

import { query, queryOne } from '@/lib/db';
import { updateExpense, FIXED_SOURCE_EXCLUDE_LOCKED } from '../queries';

// biome-ignore lint/suspicious/noExplicitAny: test mock convenience
type Any = any;

describe('updateExpense — source=fixed 행 exclude_from_budget 가드', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("source='fixed' 행 + exclude_from_budget 변경 → 에러 throw, UPDATE 미실행", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ source: 'fixed' } as Any);

    await expect(updateExpense(1, 686, { exclude_from_budget: true })).rejects.toThrow(
      FIXED_SOURCE_EXCLUDE_LOCKED,
    );

    // SELECT만 1회, UPDATE는 호출되지 않음
    expect(queryOne).toHaveBeenCalledTimes(1);
    expect(query).not.toHaveBeenCalled();
  });

  it("source='manual' 행 + exclude_from_budget 변경 → 정상 진행", async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ source: 'manual' } as Any) // 가드 SELECT
      .mockResolvedValueOnce({ id: 100, exclude_from_budget: true } as Any); // UPDATE RETURNING

    const result = await updateExpense(1, 100, { exclude_from_budget: true });

    expect(result).toEqual({ id: 100, exclude_from_budget: true });
    expect(queryOne).toHaveBeenCalledTimes(2);
  });

  it('source=null 행 + exclude_from_budget 변경 → 정상 진행', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ source: null } as Any)
      .mockResolvedValueOnce({ id: 200 } as Any);

    await expect(updateExpense(1, 200, { exclude_from_budget: false })).resolves.toBeTruthy();
  });

  it("source='fixed' 행 + amount만 변경(exclude_from_budget 미포함) → 가드 미발동, 정상 진행", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ id: 686, amount: 167776 } as Any);

    const result = await updateExpense(1, 686, { amount: 167776 });

    expect(result).toEqual({ id: 686, amount: 167776 });
    // 가드 SELECT 없이 바로 UPDATE 1회
    expect(queryOne).toHaveBeenCalledTimes(1);
    const sql = vi.mocked(queryOne).mock.calls[0]![0] as string;
    expect(sql).toMatch(/UPDATE\s+expenses\s+SET/i);
  });

  it('허용되지 않는 컬럼만 포함된 updates → SELECT (현재 행 반환), UPDATE 미실행', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ id: 1, amount: 100 } as Any);

    const result = await updateExpense(1, 1, { unknown_col: 'x' });

    expect(result).toEqual({ id: 1, amount: 100 });
    expect(queryOne).toHaveBeenCalledTimes(1);
    const sql = vi.mocked(queryOne).mock.calls[0]![0] as string;
    expect(sql).toMatch(/SELECT/i);
    expect(sql).not.toMatch(/UPDATE/i);
  });
});
