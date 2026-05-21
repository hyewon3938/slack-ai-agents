import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

vi.mock('../repository/settings-repo', () => ({
  readTargetMonth: vi.fn(),
  computeInstallmentToggleAdjustment: vi.fn(),
  applyInstallmentToggleAdjustment: vi.fn(),
  computeExcludeToggleAdjustment: vi.fn(),
  applyExcludeToggleAdjustment: vi.fn(),
}));

vi.mock('../repository/assets-repo', () => ({
  applyAssetDeduction: vi.fn(),
  applyAssetIncrease: vi.fn(),
}));

import { query, queryOne } from '@/lib/db';
import {
  computeExcludeToggleAdjustment,
  applyExcludeToggleAdjustment,
} from '../repository/settings-repo';
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

  it("source='manual' 행 + exclude_from_budget 변경 (비할부) → 정상 진행", async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ source: 'manual' } as Any) // 가드 SELECT
      .mockResolvedValueOnce({ installment_group: null } as Any) // existingForAsset (excludeChanging 추가)
      .mockResolvedValueOnce({ id: 100, exclude_from_budget: true } as Any); // UPDATE RETURNING

    const result = await updateExpense(1, 100, { exclude_from_budget: true });

    expect(result).toEqual({ id: 100, exclude_from_budget: true });
    expect(queryOne).toHaveBeenCalledTimes(3);
    expect(computeExcludeToggleAdjustment).not.toHaveBeenCalled();
  });

  it('source=null 행 + exclude_from_budget 변경 (비할부) → 정상 진행', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ source: null } as Any)
      .mockResolvedValueOnce({ installment_group: null } as Any)
      .mockResolvedValueOnce({ id: 200 } as Any);

    await expect(updateExpense(1, 200, { exclude_from_budget: false })).resolves.toBeTruthy();
    expect(computeExcludeToggleAdjustment).not.toHaveBeenCalled();
  });

  it("source='fixed' 행 + amount만 변경(exclude_from_budget 미포함) → 자산 보정용 SELECT + UPDATE", async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({
        amount: 100000,
        is_installment: false,
        installment_num: null,
        type: 'expense',
        exclude_from_budget: true,
      } as Any) // 자산 보정용 사전 조회
      .mockResolvedValueOnce({ id: 686, amount: 167776 } as Any); // UPDATE RETURNING

    const result = await updateExpense(1, 686, { amount: 167776 });

    expect(result).toEqual({ id: 686, amount: 167776 });
    // amount 변경 시 사전 SELECT(자산 보정 판정용) + UPDATE
    expect(queryOne).toHaveBeenCalledTimes(2);
    const selectSql = vi.mocked(queryOne).mock.calls[0]![0] as string;
    expect(selectSql).toMatch(/SELECT/i);
    const updateSql = vi.mocked(queryOne).mock.calls[1]![0] as string;
    expect(updateSql).toMatch(/UPDATE\s+expenses\s+SET/i);
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

describe('updateExpense — exclude_from_budget 할부 그룹 동기화', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('할부 행 + exclude=false→true: 그룹 UPDATE 호출 + applyExcludeToggleAdjustment 호출 (delta 음수)', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ source: 'manual' } as Any) // 가드
      .mockResolvedValueOnce({
        amount: 100000,
        is_installment: true,
        installment_num: 3,
        type: 'expense',
        exclude_from_budget: false,
        distribute_to_runway: true,
        billing_month: '2026-07',
        installment_group: 'group-1',
      } as Any) // existingForAsset
      .mockResolvedValueOnce({ id: 100, exclude_from_budget: true } as Any); // queryExpense (setKeys empty)

    vi.mocked(computeExcludeToggleAdjustment).mockResolvedValueOnce({
      groupId: 'group-1',
      deltaAmount: -200000,
    });

    await updateExpense(1, 100, { exclude_from_budget: true });

    expect(computeExcludeToggleAdjustment).toHaveBeenCalledWith(1, 'group-1', true);
    expect(applyExcludeToggleAdjustment).toHaveBeenCalledWith(1, {
      groupId: 'group-1',
      deltaAmount: -200000,
    });
    const groupUpdate = vi
      .mocked(query)
      .mock.calls.find((c) =>
        (c[0] as string).match(/UPDATE\s+expenses\s+SET\s+exclude_from_budget/i),
      );
    expect(groupUpdate).toBeDefined();
    expect((groupUpdate![1] as unknown[])[2]).toBe('group-1');
  });

  it('할부 행 + exclude=true→false: 그룹 UPDATE 호출 + applyExcludeToggleAdjustment 호출 (delta 양수)', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ source: 'manual' } as Any)
      .mockResolvedValueOnce({
        amount: 100000,
        is_installment: true,
        installment_num: 3,
        type: 'expense',
        exclude_from_budget: true,
        distribute_to_runway: true,
        billing_month: '2026-07',
        installment_group: 'group-2',
      } as Any)
      .mockResolvedValueOnce({ id: 101, exclude_from_budget: false } as Any);

    vi.mocked(computeExcludeToggleAdjustment).mockResolvedValueOnce({
      groupId: 'group-2',
      deltaAmount: 300000,
    });

    await updateExpense(1, 101, { exclude_from_budget: false });

    expect(computeExcludeToggleAdjustment).toHaveBeenCalledWith(1, 'group-2', false);
    expect(applyExcludeToggleAdjustment).toHaveBeenCalledWith(1, {
      groupId: 'group-2',
      deltaAmount: 300000,
    });
  });

  it('비할부 행 (installment_group=null) + exclude 변경: 단일 행 UPDATE만, 자산 보정 호출 없음', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ source: 'manual' } as Any)
      .mockResolvedValueOnce({
        amount: 50000,
        is_installment: false,
        installment_num: null,
        type: 'expense',
        exclude_from_budget: false,
        distribute_to_runway: true,
        billing_month: '2026-05',
        installment_group: null,
      } as Any)
      .mockResolvedValueOnce({ id: 200, exclude_from_budget: true } as Any); // UPDATE single row RETURNING

    await updateExpense(1, 200, { exclude_from_budget: true });

    expect(computeExcludeToggleAdjustment).not.toHaveBeenCalled();
    expect(applyExcludeToggleAdjustment).not.toHaveBeenCalled();
    // 그룹 UPDATE는 호출되지 않음 — 단일 행 UPDATE만 (UPDATE RETURNING)
    const groupUpdate = vi
      .mocked(query)
      .mock.calls.find((c) =>
        (c[0] as string).match(/UPDATE\s+expenses\s+SET\s+exclude_from_budget/i),
      );
    expect(groupUpdate).toBeUndefined();
  });

  it('할부 행 + exclude + amount 동시 변경: 그룹 UPDATE + 자산 보정 + 단일행 UPDATE 모두 실행', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ source: 'manual' } as Any)
      .mockResolvedValueOnce({
        amount: 100000,
        is_installment: true,
        installment_num: 3,
        type: 'expense',
        exclude_from_budget: false,
        distribute_to_runway: true,
        billing_month: '2026-07',
        installment_group: 'group-3',
      } as Any)
      .mockResolvedValueOnce({ id: 102, amount: 120000, exclude_from_budget: true } as Any);

    vi.mocked(computeExcludeToggleAdjustment).mockResolvedValueOnce({
      groupId: 'group-3',
      deltaAmount: -200000,
    });

    await updateExpense(1, 102, { exclude_from_budget: true, amount: 120000 });

    expect(computeExcludeToggleAdjustment).toHaveBeenCalled();
    expect(applyExcludeToggleAdjustment).toHaveBeenCalled();
    // 그룹 UPDATE (exclude_from_budget) — query 호출
    const groupUpdate = vi
      .mocked(query)
      .mock.calls.find((c) =>
        (c[0] as string).match(/UPDATE\s+expenses\s+SET\s+exclude_from_budget/i),
      );
    expect(groupUpdate).toBeDefined();
    // 단일행 UPDATE (amount만, exclude_from_budget는 filter됨) — queryOne 호출
    const lastQueryOneCall = vi.mocked(queryOne).mock.calls.at(-1);
    expect(lastQueryOneCall![0]).toMatch(/UPDATE\s+expenses\s+SET\s+amount/i);
    expect(lastQueryOneCall![0]).not.toMatch(/exclude_from_budget\s*=/i);
  });
});
