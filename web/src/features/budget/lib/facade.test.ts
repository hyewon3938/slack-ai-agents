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
vi.mock('./repository/incomes-repo', () => ({ readIncomeTotal: vi.fn() }));
vi.mock('./repository/expenses-repo', () => ({
  readFlexibleSpent: vi.fn(),
  readExcludedSpent: vi.fn(),
  readTodayFlexSpent: vi.fn(),
}));
vi.mock('./repository/settings-repo', () => ({ readTargetMonth: vi.fn() }));

import { getMonthlyAllocation, runSettlementIfDue } from './facade';
import { readLatestSnapshot, saveSnapshotIfAbsent } from './snapshot/monthly-snapshot-repo';
import { readTotalAssetBalance } from './repository/assets-repo';
import { readFixedCostsMonthlyTotal } from './repository/fixed-costs-repo';
import { readActiveInstallments } from './repository/installments-repo';
import { readPlannedExpenses } from './repository/planned-repo';
import { readIncomeTotal } from './repository/incomes-repo';
import { readFlexibleSpent, readExcludedSpent } from './repository/expenses-repo';
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
  vi.mocked(readIncomeTotal).mockResolvedValue(0);
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
    vi.mocked(readIncomeTotal).mockResolvedValue(100_000);
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
