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

    // SELECT source만 1회, UPDATE는 호출되지 않음
    expect(queryOne).toHaveBeenCalledTimes(1);
    expect(query).not.toHaveBeenCalled();
  });

  it("source='manual' 행 + exclude_from_budget 변경 → 가드 통과 후 단일 UPDATE", async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ source: 'manual' } as Any) // 가드 SELECT
      .mockResolvedValueOnce({ id: 100, exclude_from_budget: true } as Any); // UPDATE RETURNING

    const result = await updateExpense(1, 100, { exclude_from_budget: true });

    expect(result).toEqual({ id: 100, exclude_from_budget: true });
    expect(queryOne).toHaveBeenCalledTimes(2);
    const updateSql = vi.mocked(queryOne).mock.calls[1]![0] as string;
    expect(updateSql).toMatch(/UPDATE\s+expenses\s+SET/i);
  });
});

describe('updateExpense — 단순 화이트리스트 UPDATE (#539, 자산 보정·그룹 동기화 없음)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('amount만 변경 → 가드 SELECT 없이 단일 UPDATE', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ id: 686, amount: 167776 } as Any);

    const result = await updateExpense(1, 686, { amount: 167776 });

    expect(result).toEqual({ id: 686, amount: 167776 });
    // exclude 미변경 → 가드 SELECT 없음. UPDATE 한 번만.
    expect(queryOne).toHaveBeenCalledTimes(1);
    const sql = vi.mocked(queryOne).mock.calls[0]![0] as string;
    expect(sql).toMatch(/UPDATE\s+expenses\s+SET\s+amount/i);
  });

  it('할부 회차 amount 변경 → 그룹 동기화·자산 보정 query() 없이 단일 행 UPDATE만', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ id: 100, amount: 50000 } as Any);

    await updateExpense(1, 100, { amount: 50000 });

    // 등록시점 차감 폐지 → 그룹 UPDATE/자산 보정용 추가 query() 호출이 없어야 함
    expect(query).not.toHaveBeenCalled();
    expect(queryOne).toHaveBeenCalledTimes(1);
  });

  it('허용되지 않는 컬럼만 → SELECT(현재 행 반환), UPDATE 미실행', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ id: 1, amount: 100 } as Any);

    const result = await updateExpense(1, 1, { unknown_col: 'x' });

    expect(result).toEqual({ id: 1, amount: 100 });
    expect(queryOne).toHaveBeenCalledTimes(1);
    const sql = vi.mocked(queryOne).mock.calls[0]![0] as string;
    expect(sql).toMatch(/SELECT/i);
    expect(sql).not.toMatch(/UPDATE/i);
  });

  it('distribute_to_runway는 화이트리스트에서 제외 → 단독 전달 시 UPDATE 미실행', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ id: 5 } as Any);

    await updateExpense(1, 5, { distribute_to_runway: false });

    // 유효 키 0개 → queryExpense(SELECT)만
    expect(queryOne).toHaveBeenCalledTimes(1);
    const sql = vi.mocked(queryOne).mock.calls[0]![0] as string;
    expect(sql).toMatch(/SELECT/i);
    expect(sql).not.toMatch(/UPDATE/i);
  });
});
