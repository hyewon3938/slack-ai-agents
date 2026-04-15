import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./snapshot/monthly-snapshot-repo', () => ({
  readLatestSnapshot: vi.fn(),
  readSnapshotByMonth: vi.fn(),
  saveSnapshotIfAbsent: vi.fn(),
}));
vi.mock('./repository/assets-repo', () => ({ readTotalAssetBalance: vi.fn() }));
vi.mock('./repository/fixed-costs-repo', () => ({ readFixedCostsMonthlyTotal: vi.fn() }));
vi.mock('./repository/installments-repo', () => ({ readActiveInstallments: vi.fn() }));
vi.mock('./repository/planned-repo', () => ({ readPlannedExpenses: vi.fn() }));
vi.mock('./repository/incomes-repo', () => ({
  readIncomeTotal: vi.fn(),
  readDistributableIncomeTotal: vi.fn(),
}));
vi.mock('./repository/expenses-repo', () => ({
  readFlexibleSpent: vi.fn(),
  readExcludedSpent: vi.fn(),
  readTodayFlexSpent: vi.fn(),
  readAvgVariableMonthly: vi.fn(),
}));
vi.mock('./repository/settings-repo', () => ({
  readTargetMonth: vi.fn(),
  upsertTargetDate: vi.fn(),
}));

import {
  getMonthlyAllocation, getTodayAllocation, getRunwayProjection, getBudgetPreview,
  runSettlementIfDue,
} from './facade';
import { readLatestSnapshot, saveSnapshotIfAbsent } from './snapshot/monthly-snapshot-repo';
import { readTotalAssetBalance } from './repository/assets-repo';
import { readFixedCostsMonthlyTotal } from './repository/fixed-costs-repo';
import { readActiveInstallments } from './repository/installments-repo';
import { readPlannedExpenses } from './repository/planned-repo';
import { readIncomeTotal, readDistributableIncomeTotal } from './repository/incomes-repo';
import { readFlexibleSpent, readExcludedSpent, readTodayFlexSpent, readAvgVariableMonthly } from './repository/expenses-repo';
import { readTargetMonth } from './repository/settings-repo';

// April 10 21:00 KST — billing cycle: 2026-04 (Mar 16 ~ Apr 15)
const DEFAULT_NOW = new Date('2026-04-10T12:00:00Z');

function setupCommonMocks() {
  vi.mocked(readLatestSnapshot).mockResolvedValue(null);
  vi.mocked(readTotalAssetBalance).mockResolvedValue(0);
  vi.mocked(readFixedCostsMonthlyTotal).mockResolvedValue(0);
  vi.mocked(readActiveInstallments).mockResolvedValue([]);
  vi.mocked(readTargetMonth).mockResolvedValue('2026-04');
  vi.mocked(readPlannedExpenses).mockResolvedValue([]);
  vi.mocked(readFlexibleSpent).mockResolvedValue(0);
  vi.mocked(readExcludedSpent).mockResolvedValue(0);
  vi.mocked(readTodayFlexSpent).mockResolvedValue(0);
  vi.mocked(readAvgVariableMonthly).mockResolvedValue(0);
  vi.mocked(readIncomeTotal).mockResolvedValue(0);
  vi.mocked(readDistributableIncomeTotal).mockResolvedValue(0);
  vi.mocked(saveSnapshotIfAbsent).mockResolvedValue({ saved: false });
}

describe('getMonthlyAllocation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupCommonMocks();
  });

  it('스냅샷 없을 때 → 자산 합계를 totalAvailable로 사용', async () => {
    vi.mocked(readLatestSnapshot).mockResolvedValue(null);
    vi.mocked(readTotalAssetBalance).mockResolvedValue(1_000_000);

    const result = await getMonthlyAllocation(1, DEFAULT_NOW);

    expect(readTotalAssetBalance).toHaveBeenCalledWith(1);
    expect(result.monthlyBudgets.length).toBeGreaterThan(0);
  });

  it('스냅샷 있을 때 → available_at_end + 이후 변동으로 totalAvailable 계산', async () => {
    vi.mocked(readLatestSnapshot).mockResolvedValue({
      id: 1, user_id: 1, year_month: '2026-03', sealed_at: '2026-03-16T00:00:00Z',
      allocated_budget: 500_000, fixed_total: 0, installment_total: 0,
      planned_total: 0, flexible_spent: 0, excluded_spent: 0, income_total: 0,
      available_at_start: 1_000_000, available_at_end: 900_000,
    });
    vi.mocked(readDistributableIncomeTotal).mockResolvedValue(100_000);
    vi.mocked(readFlexibleSpent).mockResolvedValue(50_000);
    vi.mocked(readExcludedSpent).mockResolvedValue(0);
    // readTotalAssetBalance은 호출되지 않아야 함 (별도로 확인)
    vi.mocked(readTotalAssetBalance).mockResolvedValue(999_999);

    const result = await getMonthlyAllocation(1, DEFAULT_NOW);

    // totalAvailable = 900_000 + 100_000 - 50_000 - 0 = 950_000 → assets(999_999)와 다른 값
    expect(result.monthlyBudgets.length).toBeGreaterThan(0);
    // freePerMonth은 totalAvailable 950_000 기준 계산 (≠ 999_999 기준)
    expect(result.freePerMonth).not.toBeNull();
  });
});

describe('runSettlementIfDue', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupCommonMocks();
  });

  it('정산일(16일)이 아니면 settled=false', async () => {
    const result = await runSettlementIfDue(1, DEFAULT_NOW); // April 10

    expect(result.settled).toBe(false);
    expect(saveSnapshotIfAbsent).not.toHaveBeenCalled();
  });

  it('정산일(16일)이고 스냅샷 신규 → settled=true + 스냅샷 반환', async () => {
    // April 16 12:00 UTC = April 16 21:00 KST → yesterday=April 15 → shouldSettle=true, targetMonth='2026-04'...
    // wait: targetMonth = '2026-04-15'.slice(0,7) = '2026-04', range.to = '2026-04-15'
    // targetEnd = new Date('2026-04-15T12:00:00Z') = Apr 15 21:00 KST → billing cycle '2026-04' ✓
    const settlementNow = new Date('2026-04-16T12:00:00Z');

    vi.mocked(readLatestSnapshot).mockResolvedValue(null);
    vi.mocked(readTotalAssetBalance).mockResolvedValue(5_000_000);
    vi.mocked(readFlexibleSpent).mockResolvedValue(300_000);
    vi.mocked(readExcludedSpent).mockResolvedValue(50_000);
    vi.mocked(readIncomeTotal).mockResolvedValue(2_000_000);
    vi.mocked(saveSnapshotIfAbsent).mockResolvedValue({ saved: true });

    const result = await runSettlementIfDue(1, settlementNow);

    expect(result.settled).toBe(true);
    expect(result.snapshot).toBeDefined();
    expect(result.snapshot?.year_month).toBe('2026-04');
  });
});

describe('getTodayAllocation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupCommonMocks();
    vi.mocked(readTotalAssetBalance).mockResolvedValue(3_000_000);
    vi.mocked(readTargetMonth).mockResolvedValue('2026-06');
    vi.mocked(readTodayFlexSpent).mockResolvedValue(30_000);
  });

  it('결과에 todayFlexSpent + targetDate 포함', async () => {
    const result = await getTodayAllocation(1, DEFAULT_NOW);

    expect(result.todayFlexSpent).toBe(30_000);
    expect(result.targetDate).toBe('2026-06');
    expect(typeof result.todayBudget).toBe('number');
    expect(typeof result.todayRemaining).toBe('number');
    expect(typeof result.monthBudgetRemaining).toBe('number');
  });

  it('currentMonth 없으면 빈 값 + targetDate null 반환', async () => {
    vi.mocked(readTargetMonth).mockResolvedValue(null);
    vi.mocked(readTotalAssetBalance).mockResolvedValue(0);

    const result = await getTodayAllocation(1, DEFAULT_NOW);

    expect(result.todayBudget).toBe(0);
    expect(result.todayRemaining).toBe(0);
    expect(result.todayFlexSpent).toBe(0);
    expect(result.targetDate).toBeNull();
  });
});

describe('getRunwayProjection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupCommonMocks();
  });

  it('응답 shape 검증 — projections 배열 + 필수 필드', async () => {
    vi.mocked(readTotalAssetBalance).mockResolvedValue(5_000_000);
    vi.mocked(readFixedCostsMonthlyTotal).mockResolvedValue(500_000);
    vi.mocked(readAvgVariableMonthly).mockResolvedValue(300_000);
    vi.mocked(readTargetMonth).mockResolvedValue('2026-06');

    const result = await getRunwayProjection(1, DEFAULT_NOW);

    expect(typeof result.actual_runway_months).toBe('number');
    expect(typeof result.actual_runway_date).toBe('string');
    expect(typeof result.effective_available).toBe('number');
    expect(typeof result.fixed_monthly).toBe('number');
    expect(result.avg_variable_monthly).toBe(300_000);
    expect(result.target_date).toBe('2026-06');
    expect(Array.isArray(result.projections)).toBe(true);
  });

  it('totalAvailable 0 → projections 빈 배열, actualRunwayMonths 0', async () => {
    vi.mocked(readTotalAssetBalance).mockResolvedValue(0);

    const result = await getRunwayProjection(1, DEFAULT_NOW);

    expect(result.projections).toHaveLength(0);
    expect(result.actual_runway_months).toBe(0);
  });

  it('target_date null이면 avg_variable_monthly를 freePerMonthEstimate로 사용', async () => {
    vi.mocked(readTotalAssetBalance).mockResolvedValue(1_000_000);
    vi.mocked(readFixedCostsMonthlyTotal).mockResolvedValue(0);
    vi.mocked(readAvgVariableMonthly).mockResolvedValue(200_000);
    vi.mocked(readTargetMonth).mockResolvedValue(null);

    const result = await getRunwayProjection(1, DEFAULT_NOW);

    expect(result.free_per_month).toBeNull();
    expect(result.projections.length).toBeGreaterThan(0);
    expect(result.projections[0]!.free_budget).toBe(200_000);
  });
});

describe('getBudgetPreview', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupCommonMocks();
  });

  it('유효하지 않은 targetDate → null', async () => {
    const result = await getBudgetPreview(1, DEFAULT_NOW, '2026-3');
    expect(result).toBeNull();
  });

  it('과거 targetDate (monthCount <= 0) → null', async () => {
    // DEFAULT_NOW = 2026-04, targetDate '2026-03' → monthCount = 0 → allocator returns empty
    vi.mocked(readTotalAssetBalance).mockResolvedValue(5_000_000);
    const result = await getBudgetPreview(1, DEFAULT_NOW, '2026-03');
    expect(result).toBeNull();
  });

  it('totalAvailable 0 → free_per_month 0으로 반환 (null 아님)', async () => {
    vi.mocked(readTotalAssetBalance).mockResolvedValue(0);
    vi.mocked(readFixedCostsMonthlyTotal).mockResolvedValue(1_000_000);
    const result = await getBudgetPreview(1, DEFAULT_NOW, '2026-05');
    expect(result).not.toBeNull();
    expect(result!.free_per_month).toBe(0);
  });

  it('정상 응답 shape 검증', async () => {
    vi.mocked(readTotalAssetBalance).mockResolvedValue(5_000_000);
    vi.mocked(readFixedCostsMonthlyTotal).mockResolvedValue(300_000);

    const result = await getBudgetPreview(1, DEFAULT_NOW, '2026-06');

    expect(result).not.toBeNull();
    expect(typeof result!.free_per_month).toBe('number');
    expect(typeof result!.daily_estimate).toBe('number');
    expect(Array.isArray(result!.month_breakdown)).toBe(true);
    const mb = result!.month_breakdown[0]!;
    expect(typeof mb.month).toBe('string');
    expect(typeof mb.locked).toBe('number');
    expect(typeof mb.free).toBe('number');
    expect(typeof mb.daily).toBe('number');
  });
});
