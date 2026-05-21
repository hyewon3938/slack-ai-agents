import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./snapshot/monthly-snapshot-repo', () => ({
  readLatestSnapshot: vi.fn(),
  readSnapshotByMonth: vi.fn(),
  saveSnapshotIfAbsent: vi.fn(),
}));
vi.mock('./repository/assets-repo', () => ({
  readDistributableAssetBalance: vi.fn(),
  applyAssetDeduction: vi.fn(),
  applyAssetIncrease: vi.fn(),
}));
vi.mock('./repository/fixed-costs-repo', () => ({ readFixedCostsMonthlyTotal: vi.fn() }));
vi.mock('./repository/installments-repo', () => ({ readActiveInstallments: vi.fn() }));
vi.mock('./repository/planned-repo', () => ({ readPlannedExpenses: vi.fn() }));
vi.mock('./repository/incomes-repo', () => ({
  readIncomeTotal: vi.fn(),
  readCurrentMonthOnlyIncome: vi.fn(),
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
  getMonthlyAllocation,
  getTodayAllocation,
  getRunwayProjection,
  getBudgetPreview,
  runSettlementIfDue,
} from './facade';
import { readLatestSnapshot, saveSnapshotIfAbsent } from './snapshot/monthly-snapshot-repo';
import {
  readDistributableAssetBalance,
  applyAssetDeduction,
  applyAssetIncrease,
} from './repository/assets-repo';
import { readFixedCostsMonthlyTotal } from './repository/fixed-costs-repo';
import { readActiveInstallments } from './repository/installments-repo';
import { readPlannedExpenses } from './repository/planned-repo';
import { readIncomeTotal, readCurrentMonthOnlyIncome } from './repository/incomes-repo';
import {
  readFlexibleSpent,
  readExcludedSpent,
  readTodayFlexSpent,
  readAvgVariableMonthly,
} from './repository/expenses-repo';
import { readTargetMonth } from './repository/settings-repo';

// April 10 21:00 KST — billing cycle: 2026-04 (Mar 14 ~ Apr 13)
const DEFAULT_NOW = new Date('2026-04-10T12:00:00Z');

function setupCommonMocks() {
  vi.mocked(readLatestSnapshot).mockResolvedValue(null);
  vi.mocked(readDistributableAssetBalance).mockResolvedValue(0);
  vi.mocked(readFixedCostsMonthlyTotal).mockResolvedValue(0);
  vi.mocked(readActiveInstallments).mockResolvedValue([]);
  vi.mocked(readTargetMonth).mockResolvedValue('2026-04');
  vi.mocked(readPlannedExpenses).mockResolvedValue([]);
  vi.mocked(readFlexibleSpent).mockResolvedValue(0);
  vi.mocked(readExcludedSpent).mockResolvedValue(0);
  vi.mocked(readTodayFlexSpent).mockResolvedValue(0);
  vi.mocked(readAvgVariableMonthly).mockResolvedValue(0);
  vi.mocked(readIncomeTotal).mockResolvedValue(0);
  vi.mocked(readCurrentMonthOnlyIncome).mockResolvedValue(0);
  vi.mocked(saveSnapshotIfAbsent).mockResolvedValue({ saved: false });
  vi.mocked(applyAssetDeduction).mockResolvedValue([]);
  vi.mocked(applyAssetIncrease).mockResolvedValue([]);
}

describe('getMonthlyAllocation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupCommonMocks();
  });

  it('스냅샷 없을 때 → 자산 합계를 totalAvailable로 사용', async () => {
    vi.mocked(readLatestSnapshot).mockResolvedValue(null);
    vi.mocked(readDistributableAssetBalance).mockResolvedValue(1_000_000);

    const result = await getMonthlyAllocation(1, DEFAULT_NOW);

    expect(readDistributableAssetBalance).toHaveBeenCalledWith(1);
    expect(result.monthlyBudgets.length).toBeGreaterThan(0);
  });

  it('스냅샷 있어도 → 현재 자산 잔액을 totalAvailable로 사용', async () => {
    vi.mocked(readLatestSnapshot).mockResolvedValue({
      id: 1,
      user_id: 1,
      year_month: '2026-03',
      sealed_at: '2026-03-16T00:00:00Z',
      allocated_budget: 500_000,
      fixed_total: 0,
      installment_total: 0,
      planned_total: 0,
      flexible_spent: 0,
      excluded_spent: 0,
      income_total: 0,
      available_at_start: 1_000_000,
      available_at_end: 900_000,
    });
    vi.mocked(readDistributableAssetBalance).mockResolvedValue(999_999);

    const result = await getMonthlyAllocation(1, DEFAULT_NOW);

    // totalAvailable = currentAssets = 999_999 (스냅샷 무관, 자산 잔액 직접 사용)
    expect(result.monthlyBudgets.length).toBeGreaterThan(0);
    expect(result.freePerMonth).not.toBeNull();
  });

  it('readCurrentMonthOnlyIncome 을 billing_month + 오늘 범위로 호출', async () => {
    vi.mocked(readDistributableAssetBalance).mockResolvedValue(1_000_000);
    await getMonthlyAllocation(1, DEFAULT_NOW);
    expect(readCurrentMonthOnlyIncome).toHaveBeenCalledWith(1, '2026-04', '2026-04-10');
  });

  it('currentMonthOnlyIncome > 0 → 현재 월 free 에 독점 귀속, 다른 월은 오히려 감소', async () => {
    // totalAvailable = 1_000_000, bonus = 50_000, target = 2026-05
    // sumDays = 31(Apr) + 30(May) = 61
    // totalFree = 950_000, dailyFree = 950_000/61 ≈ 15_573.77
    // current free = round(15_573.77 * 31) + 50_000 = 482_787 + 50_000 = 532_787
    // may free     = round(15_573.77 * 30) = 467_213
    vi.mocked(readDistributableAssetBalance).mockResolvedValue(1_000_000);
    vi.mocked(readTargetMonth).mockResolvedValue('2026-05');
    vi.mocked(readCurrentMonthOnlyIncome).mockResolvedValue(50_000);

    const result = await getMonthlyAllocation(1, DEFAULT_NOW);
    const current = result.monthlyBudgets.find((m) => m.isCurrent)!;
    const future = result.monthlyBudgets.find((m) => !m.isCurrent)!;

    expect(current.free).toBe(532_787);
    expect(future.free).toBe(467_213);
    // 총 합은 totalAvailable 과 동일해야 함 (bonus 중복 없음)
    expect(current.free + future.free).toBe(1_000_000);
  });
});

describe('runSettlementIfDue', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupCommonMocks();
  });

  it('정산일(14일)이 아니면 settled=false', async () => {
    const result = await runSettlementIfDue(1, DEFAULT_NOW); // April 10

    expect(result.settled).toBe(false);
    expect(saveSnapshotIfAbsent).not.toHaveBeenCalled();
  });

  it('정산일(14일)이고 스냅샷 신규 → settled=true + 스냅샷 반환', async () => {
    // April 15 12:00 UTC = April 15 21:00 KST → yesterday=April 14 → shouldSettle=true, targetMonth='2026-04'
    // range.to = '2026-04-14' (cycle 15→14 boundary)
    // targetEnd = new Date('2026-04-14T12:00:00Z') = Apr 14 21:00 KST → billing cycle '2026-04' ✓
    const settlementNow = new Date('2026-04-15T12:00:00Z');

    vi.mocked(readLatestSnapshot).mockResolvedValue(null);
    vi.mocked(readDistributableAssetBalance).mockResolvedValue(5_000_000);
    vi.mocked(readFlexibleSpent).mockResolvedValue(300_000);
    vi.mocked(readExcludedSpent).mockResolvedValue(50_000);
    vi.mocked(readIncomeTotal).mockResolvedValue(2_000_000);
    vi.mocked(saveSnapshotIfAbsent).mockResolvedValue({ saved: true });

    const result = await runSettlementIfDue(1, settlementNow);

    expect(result.settled).toBe(true);
    expect(result.snapshot).toBeDefined();
    expect(result.snapshot?.year_month).toBe('2026-04');
  });

  it('available_at_end = availableAtStart + income - flex - excluded (자산 미참조)', async () => {
    const settlementNow = new Date('2026-04-15T12:00:00Z');

    vi.mocked(readLatestSnapshot).mockResolvedValue(null);
    vi.mocked(readDistributableAssetBalance).mockResolvedValue(5_000_000);
    vi.mocked(readFlexibleSpent).mockResolvedValue(300_000);
    vi.mocked(readExcludedSpent).mockResolvedValue(50_000);
    vi.mocked(readIncomeTotal).mockResolvedValue(200_000);
    vi.mocked(saveSnapshotIfAbsent).mockResolvedValue({ saved: true });

    const result = await runSettlementIfDue(1, settlementNow);

    // availableAtStart = 5_000_000 (자산 fallback)
    // availableAtEnd = 5_000_000 + 200_000 - 300_000 - 50_000 = 4_850_000
    expect(result.snapshot?.available_at_end).toBe(4_850_000);
    expect(result.snapshot?.available_at_start).toBe(5_000_000);
  });

  it('snapshot 신규 저장 시 자산 자동 차감/증액 호출 (flex + excluded, income 분리)', async () => {
    const settlementNow = new Date('2026-04-15T12:00:00Z');

    vi.mocked(readLatestSnapshot).mockResolvedValue(null);
    vi.mocked(readDistributableAssetBalance).mockResolvedValue(5_000_000);
    vi.mocked(readFlexibleSpent).mockResolvedValue(300_000);
    vi.mocked(readExcludedSpent).mockResolvedValue(50_000);
    vi.mocked(readIncomeTotal).mockResolvedValue(200_000);
    vi.mocked(saveSnapshotIfAbsent).mockResolvedValue({ saved: true });

    await runSettlementIfDue(1, settlementNow);

    expect(applyAssetDeduction).toHaveBeenCalledWith(1, 350_000); // flex + excluded
    expect(applyAssetIncrease).toHaveBeenCalledWith(1, 200_000); // income
  });

  it('snapshot 재실행(saved=false) 시 자산 변동 호출 없음 — idempotency', async () => {
    const settlementNow = new Date('2026-04-15T12:00:00Z');

    vi.mocked(readLatestSnapshot).mockResolvedValue(null);
    vi.mocked(readDistributableAssetBalance).mockResolvedValue(5_000_000);
    vi.mocked(readFlexibleSpent).mockResolvedValue(300_000);
    vi.mocked(readExcludedSpent).mockResolvedValue(50_000);
    vi.mocked(readIncomeTotal).mockResolvedValue(200_000);
    // 이미 같은 yearMonth 저장됨 — UNIQUE 제약으로 saved=false
    vi.mocked(saveSnapshotIfAbsent).mockResolvedValue({ saved: false });

    const result = await runSettlementIfDue(1, settlementNow);

    expect(result.settled).toBe(false);
    expect(applyAssetDeduction).not.toHaveBeenCalled();
    expect(applyAssetIncrease).not.toHaveBeenCalled();
  });
});

describe('getTodayAllocation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupCommonMocks();
    vi.mocked(readDistributableAssetBalance).mockResolvedValue(3_000_000);
    vi.mocked(readTargetMonth).mockResolvedValue('2026-06');
    vi.mocked(readTodayFlexSpent).mockResolvedValue(30_000);
  });

  it('결과에 todayFlexSpent + targetDate + todayRecommended 포함', async () => {
    const result = await getTodayAllocation(1, DEFAULT_NOW);

    expect(result.todayFlexSpent).toBe(30_000);
    expect(result.targetDate).toBe('2026-06');
    expect(typeof result.todayBudget).toBe('number');
    expect(typeof result.todayRecommended).toBe('number');
    expect(typeof result.todayRemaining).toBe('number');
    expect(typeof result.monthBudgetRemaining).toBe('number');
  });

  it('currentMonth 없으면 빈 값 + targetDate null 반환 (todayRecommended 0 포함)', async () => {
    vi.mocked(readTargetMonth).mockResolvedValue(null);
    vi.mocked(readDistributableAssetBalance).mockResolvedValue(0);

    const result = await getTodayAllocation(1, DEFAULT_NOW);

    expect(result.todayBudget).toBe(0);
    expect(result.todayRecommended).toBe(0);
    expect(result.todayRemaining).toBe(0);
    expect(result.monthBudgetRemaining).toBe(0);
    expect(result.todayFlexSpent).toBe(0);
    expect(result.targetDate).toBeNull();
  });

  it('readCurrentMonthOnlyIncome 을 (userId, billingMonth, todayStr) 시그니처로 호출', async () => {
    await getTodayAllocation(1, DEFAULT_NOW);
    // DEFAULT_NOW = 2026-04-10 21:00 KST → billing_month '2026-04', todayStr '2026-04-10'
    expect(readCurrentMonthOnlyIncome).toHaveBeenCalledWith(1, '2026-04', '2026-04-10');
  });

  it('수입 입력 + 자산 동시 갱신 (실제 플로우) → todayBudget(기준) 불변', async () => {
    vi.mocked(readTodayFlexSpent).mockResolvedValue(0);

    // 수입 0, 자산 3M
    vi.mocked(readDistributableAssetBalance).mockResolvedValue(3_000_000);
    vi.mocked(readCurrentMonthOnlyIncome).mockResolvedValue(0);
    const r0 = await getTodayAllocation(1, DEFAULT_NOW);

    // 수입 100k, 자산 3.1M (사용자가 자산에도 반영)
    // allocator 식: monthBudget = (자산 − 수입) × Days/sumDays + 수입
    // base = monthBudget − 수입 = (자산 − 수입) × Days/sumDays = 자산 갱신 전 값
    vi.mocked(readDistributableAssetBalance).mockResolvedValue(3_100_000);
    vi.mocked(readCurrentMonthOnlyIncome).mockResolvedValue(100_000);
    const r1 = await getTodayAllocation(1, DEFAULT_NOW);

    expect(r1.todayBudget).toBe(r0.todayBudget);
  });
});

describe('getRunwayProjection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupCommonMocks();
  });

  it('응답 shape 검증 — projections 배열 + 필수 필드', async () => {
    vi.mocked(readDistributableAssetBalance).mockResolvedValue(5_000_000);
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
    vi.mocked(readDistributableAssetBalance).mockResolvedValue(0);

    const result = await getRunwayProjection(1, DEFAULT_NOW);

    expect(result.projections).toHaveLength(0);
    expect(result.actual_runway_months).toBe(0);
  });

  it('target_date null이면 avg_variable_monthly를 freePerMonthEstimate로 사용', async () => {
    vi.mocked(readDistributableAssetBalance).mockResolvedValue(1_000_000);
    vi.mocked(readFixedCostsMonthlyTotal).mockResolvedValue(0);
    vi.mocked(readAvgVariableMonthly).mockResolvedValue(200_000);
    vi.mocked(readTargetMonth).mockResolvedValue(null);

    const result = await getRunwayProjection(1, DEFAULT_NOW);

    expect(result.free_per_month).toBeNull();
    expect(result.projections.length).toBeGreaterThan(0);
    expect(result.projections[0]!.free_budget).toBe(200_000);
  });

  it('target 설정 시 actual_runway_date === target_date (정합성 불변식)', async () => {
    vi.mocked(readDistributableAssetBalance).mockResolvedValue(1_000_000);
    vi.mocked(readFixedCostsMonthlyTotal).mockResolvedValue(0);
    vi.mocked(readAvgVariableMonthly).mockResolvedValue(999_999); // 사용 안 됨 확인
    vi.mocked(readTargetMonth).mockResolvedValue('2026-08');

    const result = await getRunwayProjection(1, DEFAULT_NOW);

    expect(result.target_date).toBe('2026-08');
    expect(result.actual_runway_date).toBe('2026-08'); // 정확히 일치
    expect(result.projections).toHaveLength(5); // 4월 ~ 8월
    expect(result.projections.at(-1)!.remaining).toBeLessThanOrEqual(10);
  });

  it('고정비/할부 있어도 target 정확히 일치', async () => {
    vi.mocked(readDistributableAssetBalance).mockResolvedValue(5_000_000);
    vi.mocked(readFixedCostsMonthlyTotal).mockResolvedValue(500_000);
    vi.mocked(readActiveInstallments).mockResolvedValue([
      { monthlyAmount: 100_000, remainingCount: 3, isNew: false },
    ]);
    vi.mocked(readTargetMonth).mockResolvedValue('2026-08');

    const result = await getRunwayProjection(1, DEFAULT_NOW);

    expect(result.actual_runway_date).toBe('2026-08');
    expect(result.projections[0]!.installments).toBeGreaterThan(0);
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
    vi.mocked(readDistributableAssetBalance).mockResolvedValue(5_000_000);
    const result = await getBudgetPreview(1, DEFAULT_NOW, '2026-03');
    expect(result).toBeNull();
  });

  it('totalAvailable 0 → free_per_month 0으로 반환 (null 아님)', async () => {
    vi.mocked(readDistributableAssetBalance).mockResolvedValue(0);
    vi.mocked(readFixedCostsMonthlyTotal).mockResolvedValue(1_000_000);
    const result = await getBudgetPreview(1, DEFAULT_NOW, '2026-05');
    expect(result).not.toBeNull();
    expect(result!.free_per_month).toBe(0);
  });

  it('정상 응답 shape 검증', async () => {
    vi.mocked(readDistributableAssetBalance).mockResolvedValue(5_000_000);
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
