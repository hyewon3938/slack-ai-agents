import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./snapshot/monthly-snapshot-repo', () => ({
  readLatestSnapshot: vi.fn(),
  readSnapshotByMonth: vi.fn(),
  saveSnapshotIfAbsent: vi.fn(),
}));
vi.mock('./repository/assets-repo', () => ({
  readDistributableAssetBalance: vi.fn(),
  readFundsAsOf: vi.fn(),
  advanceFundsAsOf: vi.fn(),
  applyAssetDeduction: vi.fn(),
  applyAssetIncrease: vi.fn(),
}));
vi.mock('./repository/fixed-costs-repo', () => ({ readFixedCostsMonthlyTotal: vi.fn() }));
vi.mock('./repository/installments-repo', () => ({ readInstallmentLockByMonth: vi.fn() }));
vi.mock('./repository/planned-repo', () => ({ readPlannedExpenses: vi.fn() }));
vi.mock('./repository/incomes-repo', () => ({
  readIncomeTotal: vi.fn(),
  readCurrentMonthOnlyIncome: vi.fn(),
  readReflectedIncome: vi.fn(),
}));
vi.mock('./repository/expenses-repo', () => ({
  readFlexibleSpent: vi.fn(),
  readExcludedSpent: vi.fn(),
  readTodayFlexSpent: vi.fn(),
  readTotalCycleSpent: vi.fn(),
  readAvgVariableMonthly: vi.fn(),
  readReflectedBudgetOutflow: vi.fn(),
  readReflectedOutflow: vi.fn(),
}));
vi.mock('./repository/settings-repo', () => ({
  readTargetMonth: vi.fn(),
  upsertTargetDate: vi.fn(),
}));
vi.mock('./fixed-cost-ensure', () => ({ ensureFixedCostExpenses: vi.fn() }));

import {
  getMonthlyAllocation,
  getTodayAllocation,
  getRunwayProjection,
  getBudgetPreview,
  runSettlementIfDue,
  listUnsettledMonths,
} from './facade';
import { readLatestSnapshot, saveSnapshotIfAbsent } from './snapshot/monthly-snapshot-repo';
import { ensureFixedCostExpenses } from './fixed-cost-ensure';
import {
  readDistributableAssetBalance,
  readFundsAsOf,
  advanceFundsAsOf,
  applyAssetDeduction,
  applyAssetIncrease,
} from './repository/assets-repo';
import { readFixedCostsMonthlyTotal } from './repository/fixed-costs-repo';
import { readInstallmentLockByMonth } from './repository/installments-repo';
import { readPlannedExpenses } from './repository/planned-repo';
import {
  readIncomeTotal,
  readCurrentMonthOnlyIncome,
  readReflectedIncome,
} from './repository/incomes-repo';
import {
  readFlexibleSpent,
  readExcludedSpent,
  readTodayFlexSpent,
  readTotalCycleSpent,
  readAvgVariableMonthly,
  readReflectedBudgetOutflow,
  readReflectedOutflow,
} from './repository/expenses-repo';
import { readTargetMonth } from './repository/settings-repo';

// April 10 21:00 KST — billing cycle: 2026-04 (Mar 14 ~ Apr 13)
const DEFAULT_NOW = new Date('2026-04-10T12:00:00Z');

function setupCommonMocks() {
  vi.mocked(readLatestSnapshot).mockResolvedValue(null);
  vi.mocked(readDistributableAssetBalance).mockResolvedValue(0);
  // 기준일 미상이 기본 — 복원 0이라 기존 기대값이 그대로 유지된다 (#615).
  vi.mocked(readFundsAsOf).mockResolvedValue(null);
  vi.mocked(advanceFundsAsOf).mockResolvedValue(undefined);
  vi.mocked(readReflectedBudgetOutflow).mockResolvedValue(0);
  vi.mocked(readReflectedOutflow).mockResolvedValue(0);
  vi.mocked(readReflectedIncome).mockResolvedValue(0);
  vi.mocked(readFixedCostsMonthlyTotal).mockResolvedValue(0);
  vi.mocked(readInstallmentLockByMonth).mockResolvedValue(new Map());
  vi.mocked(readTargetMonth).mockResolvedValue('2026-04');
  vi.mocked(readPlannedExpenses).mockResolvedValue([]);
  vi.mocked(readFlexibleSpent).mockResolvedValue(0);
  vi.mocked(readExcludedSpent).mockResolvedValue(0);
  vi.mocked(readTodayFlexSpent).mockResolvedValue(0);
  vi.mocked(readTotalCycleSpent).mockResolvedValue(0);
  vi.mocked(readAvgVariableMonthly).mockResolvedValue(0);
  vi.mocked(readIncomeTotal).mockResolvedValue(0);
  vi.mocked(readCurrentMonthOnlyIncome).mockResolvedValue(0);
  vi.mocked(saveSnapshotIfAbsent).mockResolvedValue({ saved: false });
  vi.mocked(applyAssetDeduction).mockResolvedValue([]);
  vi.mocked(applyAssetIncrease).mockResolvedValue([]);
  vi.mocked(ensureFixedCostExpenses).mockResolvedValue(0);
}

// StoredSnapshot 최소 스텁 — readLatestSnapshot 반환값용 (year_month 만 실질적으로 참조됨)
function storedSnapshot(yearMonth: string, availableAtEnd = 0) {
  return {
    id: 1,
    user_id: 1,
    year_month: yearMonth,
    sealed_at: `${yearMonth}-16T00:00:00Z`,
    allocated_budget: 0,
    fixed_total: 0,
    installment_total: 0,
    planned_total: 0,
    flexible_spent: 0,
    excluded_spent: 0,
    income_total: 0,
    available_at_start: 0,
    available_at_end: availableAtEnd,
  };
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

  // 스냅샷 없음(초회) 기준 — DEFAULT_NOW(4/10, 진행중 주기 2026-04)의 직전 종료 주기는 2026-03.
  it('스냅샷 신규 → settled=true + snapshots 배열에 대상 월 반환', async () => {
    vi.mocked(readLatestSnapshot).mockResolvedValue(null);
    vi.mocked(readDistributableAssetBalance).mockResolvedValue(5_000_000);
    vi.mocked(readFlexibleSpent).mockResolvedValue(300_000);
    vi.mocked(readExcludedSpent).mockResolvedValue(50_000);
    vi.mocked(readIncomeTotal).mockResolvedValue(2_000_000);
    vi.mocked(saveSnapshotIfAbsent).mockResolvedValue({ saved: true });

    const result = await runSettlementIfDue(1, DEFAULT_NOW);

    expect(result.settled).toBe(true);
    expect(result.snapshots).toHaveLength(1);
    expect(result.snapshots[0]?.year_month).toBe('2026-03');
  });

  it('available_at_end = availableAtStart + income - totalSpent (전체 결제분, 자산 미참조)', async () => {
    vi.mocked(readLatestSnapshot).mockResolvedValue(null);
    vi.mocked(readDistributableAssetBalance).mockResolvedValue(5_000_000);
    vi.mocked(readFlexibleSpent).mockResolvedValue(300_000);
    vi.mocked(readExcludedSpent).mockResolvedValue(50_000);
    vi.mocked(readIncomeTotal).mockResolvedValue(200_000);
    vi.mocked(readTotalCycleSpent).mockResolvedValue(350_000);
    vi.mocked(saveSnapshotIfAbsent).mockResolvedValue({ saved: true });

    const result = await runSettlementIfDue(1, DEFAULT_NOW);

    // availableAtStart = 5_000_000 (자산 fallback)
    // availableAtEnd = 5_000_000 + 200_000 - 350_000(totalSpent) = 4_850_000
    expect(result.snapshots[0]?.available_at_end).toBe(4_850_000);
    expect(result.snapshots[0]?.available_at_start).toBe(5_000_000);
  });

  it('snapshot 신규 저장 시 자산 차감 = 전체 결제분(totalSpent), 증액 = income (분리)', async () => {
    vi.mocked(readLatestSnapshot).mockResolvedValue(null);
    vi.mocked(readDistributableAssetBalance).mockResolvedValue(5_000_000);
    vi.mocked(readFlexibleSpent).mockResolvedValue(300_000);
    vi.mocked(readExcludedSpent).mockResolvedValue(50_000);
    vi.mocked(readIncomeTotal).mockResolvedValue(200_000);
    vi.mocked(readTotalCycleSpent).mockResolvedValue(350_000);
    vi.mocked(saveSnapshotIfAbsent).mockResolvedValue({ saved: true });

    await runSettlementIfDue(1, DEFAULT_NOW);

    expect(applyAssetDeduction).toHaveBeenCalledWith(1, 350_000); // totalSpent
    expect(applyAssetIncrease).toHaveBeenCalledWith(1, 200_000); // income
  });

  it('정산 차감액은 flex+excluded가 아니라 전체 결제분(totalSpent) — 할부 회차 결제 포함', async () => {
    vi.mocked(readLatestSnapshot).mockResolvedValue(null);
    vi.mocked(readDistributableAssetBalance).mockResolvedValue(5_000_000);
    vi.mocked(readFlexibleSpent).mockResolvedValue(300_000);
    vi.mocked(readExcludedSpent).mockResolvedValue(50_000);
    vi.mocked(readIncomeTotal).mockResolvedValue(0);
    // totalSpent(500_000) > flex+excluded(350_000): 할부 회차 등 150_000이 이 주기에 결제됨
    vi.mocked(readTotalCycleSpent).mockResolvedValue(500_000);
    vi.mocked(saveSnapshotIfAbsent).mockResolvedValue({ saved: true });

    const result = await runSettlementIfDue(1, DEFAULT_NOW);

    // 차감은 totalSpent 기준 (등록시점 차감 폐지 → 결제 시 한 번만 빠짐)
    expect(applyAssetDeduction).toHaveBeenCalledWith(1, 500_000);
    // 장부도 totalSpent 기준: 5_000_000 + 0 - 500_000 = 4_500_000
    expect(result.snapshots[0]?.available_at_end).toBe(4_500_000);
    // snapshot 분해 필드는 여전히 flex/excluded 분리 기록
    expect(result.snapshots[0]?.flexible_spent).toBe(300_000);
    expect(result.snapshots[0]?.excluded_spent).toBe(50_000);
  });

  // ─── #551 catch-up 시나리오 ────────────────────────────

  it('(a) 정상 실행 — 최신 스냅샷이 직전 종료 주기면 무동작(settled=false)', async () => {
    // DEFAULT_NOW(4/10) 진행중=2026-04, 직전 종료=2026-03. 이미 2026-03 스냅샷 존재 → 정산 대상 없음.
    vi.mocked(readLatestSnapshot).mockResolvedValue(storedSnapshot('2026-03'));

    const result = await runSettlementIfDue(1, DEFAULT_NOW);

    expect(result.settled).toBe(false);
    expect(result.snapshots).toHaveLength(0);
    expect(saveSnapshotIfAbsent).not.toHaveBeenCalled();
    expect(ensureFixedCostExpenses).not.toHaveBeenCalled();
  });

  it('(b) 크론 미스 후 늦게 실행 → 밀린 주기 자동 보정', async () => {
    // 진행중=2026-04, 직전 종료=2026-03. 최신 스냅샷은 2026-02(2026-03 정산이 누락됨).
    vi.mocked(readLatestSnapshot).mockResolvedValue(storedSnapshot('2026-02'));
    vi.mocked(saveSnapshotIfAbsent).mockResolvedValue({ saved: true });

    const result = await runSettlementIfDue(1, DEFAULT_NOW);

    expect(result.settled).toBe(true);
    expect(result.snapshots).toHaveLength(1);
    expect(result.snapshots[0]?.year_month).toBe('2026-03');
    // 정산 직전 고정비 보장 호출
    expect(ensureFixedCostExpenses).toHaveBeenCalledWith(1, '2026-03');
  });

  it('(c) 두 달 연속 미스 → 오래된 순으로 순차 2건 보정', async () => {
    // 진행중=2026-04, 직전 종료=2026-03. 최신 스냅샷은 2026-01 → 2026-02, 2026-03 두 주기 밀림.
    vi.mocked(readLatestSnapshot).mockResolvedValue(storedSnapshot('2026-01'));
    vi.mocked(saveSnapshotIfAbsent).mockResolvedValue({ saved: true });

    const result = await runSettlementIfDue(1, DEFAULT_NOW);

    expect(result.snapshots.map((s) => s.year_month)).toEqual(['2026-02', '2026-03']);
    expect(saveSnapshotIfAbsent).toHaveBeenCalledTimes(2);
    // 각 월마다 고정비 보장 호출
    expect(ensureFixedCostExpenses).toHaveBeenCalledWith(1, '2026-02');
    expect(ensureFixedCostExpenses).toHaveBeenCalledWith(1, '2026-03');
    // 오래된 순 보장 — 첫 저장이 2026-02
    expect(vi.mocked(saveSnapshotIfAbsent).mock.calls[0]?.[1]?.year_month).toBe('2026-02');
  });

  it('(c-cap) 장기 미스라도 오래된 순 최대 3개월만 소급 — 다음 실행이 이어서 따라잡음', async () => {
    // 진행중=2026-04, 직전 종료=2026-03. 최신 스냅샷 2025-09 → 6개월 밀렸지만 cap=3.
    vi.mocked(readLatestSnapshot).mockResolvedValue(storedSnapshot('2025-09'));
    vi.mocked(saveSnapshotIfAbsent).mockResolvedValue({ saved: true });

    const result = await runSettlementIfDue(1, DEFAULT_NOW);

    // 오래된 순 3개월 = 2025-10, 2025-11, 2025-12.
    // (최신 우선으로 자르면 정산 후 latest가 전진해 옛 주기가 영구 탈락 — 히스토리 구멍 방지)
    expect(result.snapshots.map((s) => s.year_month)).toEqual(['2025-10', '2025-11', '2025-12']);
    expect(saveSnapshotIfAbsent).toHaveBeenCalledTimes(3);
  });

  it('(d) 재실행 멱등 — 이미 저장된 주기는 saved=false → 자산 이중 변동 없음', async () => {
    vi.mocked(readLatestSnapshot).mockResolvedValue(storedSnapshot('2026-02'));
    vi.mocked(readIncomeTotal).mockResolvedValue(200_000);
    vi.mocked(readTotalCycleSpent).mockResolvedValue(350_000);
    // UNIQUE(user, year_month) 충돌 → saved=false
    vi.mocked(saveSnapshotIfAbsent).mockResolvedValue({ saved: false });

    const result = await runSettlementIfDue(1, DEFAULT_NOW);

    expect(result.settled).toBe(false);
    expect(result.snapshots).toHaveLength(0);
    expect(applyAssetDeduction).not.toHaveBeenCalled();
    expect(applyAssetIncrease).not.toHaveBeenCalled();
  });

  it('(e) 스냅샷 전무 → 직전 1개만 정산 (초회 대량 소급 방지)', async () => {
    // 최신 스냅샷 없음. 직전 종료 주기(2026-03) 1개만.
    vi.mocked(readLatestSnapshot).mockResolvedValue(null);
    vi.mocked(saveSnapshotIfAbsent).mockResolvedValue({ saved: true });

    const result = await runSettlementIfDue(1, DEFAULT_NOW);

    expect(result.snapshots).toHaveLength(1);
    expect(result.snapshots[0]?.year_month).toBe('2026-03');
    expect(saveSnapshotIfAbsent).toHaveBeenCalledTimes(1);
  });

  it('(f) 고정비 미생성 상태 → 정산 전 ensure 호출로 totalSpent 반영', async () => {
    vi.mocked(readLatestSnapshot).mockResolvedValue(storedSnapshot('2026-02'));
    vi.mocked(readDistributableAssetBalance).mockResolvedValue(5_000_000);
    vi.mocked(saveSnapshotIfAbsent).mockResolvedValue({ saved: true });

    // ensure 가 고정비 행을 생성한 뒤라야 readTotalCycleSpent 가 그 금액을 포함한다.
    // ensure 호출 후 totalSpent 가 커지는 순서를 모의: ensure 를 총지출 조회의 선행 조건으로 검증.
    let ensured = false;
    vi.mocked(ensureFixedCostExpenses).mockImplementation(async () => {
      ensured = true;
      return 1;
    });
    vi.mocked(readTotalCycleSpent).mockImplementation(async () => (ensured ? 400_000 : 0));

    const result = await runSettlementIfDue(1, DEFAULT_NOW);

    expect(ensureFixedCostExpenses).toHaveBeenCalledWith(1, '2026-03');
    // ensure 후 조회되어 고정비 포함 총지출(400_000)이 차감에 반영
    expect(applyAssetDeduction).toHaveBeenCalledWith(1, 400_000);
    expect(result.snapshots[0]?.year_month).toBe('2026-03');
  });
});

describe('listUnsettledMonths', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupCommonMocks();
  });

  it('스냅샷 전무 → 직전 종료 주기 1개', async () => {
    vi.mocked(readLatestSnapshot).mockResolvedValue(null);
    const months = await listUnsettledMonths(1, DEFAULT_NOW); // 진행중 2026-04
    expect(months).toEqual(['2026-03']);
  });

  it('최신이 직전 종료 주기 → 빈 배열 (정산 대상 없음)', async () => {
    vi.mocked(readLatestSnapshot).mockResolvedValue(storedSnapshot('2026-03'));
    const months = await listUnsettledMonths(1, DEFAULT_NOW);
    expect(months).toEqual([]);
  });

  it('최신이 직전 종료 주기보다 미래(방어) → 빈 배열', async () => {
    vi.mocked(readLatestSnapshot).mockResolvedValue(storedSnapshot('2026-05'));
    const months = await listUnsettledMonths(1, DEFAULT_NOW);
    expect(months).toEqual([]);
  });

  it('여러 주기 밀림 → (latest, lastEnded] 오래된 순', async () => {
    vi.mocked(readLatestSnapshot).mockResolvedValue(storedSnapshot('2025-12'));
    const months = await listUnsettledMonths(1, DEFAULT_NOW);
    // 2026-01, 2026-02, 2026-03 (cap 3 이내)
    expect(months).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('cap 초과 → 오래된 순 3개월만 (자기치유: 정산되면 latest 전진 → 다음 실행이 이어받음)', async () => {
    // latest=2025-06, lastEnded=2026-03 → 9개월 밀림. 오래된 순으로 자른다.
    vi.mocked(readLatestSnapshot).mockResolvedValue(storedSnapshot('2025-06'));
    const months = await listUnsettledMonths(1, DEFAULT_NOW);
    expect(months).toEqual(['2025-07', '2025-08', '2025-09']);
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
    vi.mocked(readInstallmentLockByMonth).mockResolvedValue(
      new Map([
        ['2026-04', 100_000],
        ['2026-05', 100_000],
        ['2026-06', 100_000],
      ]),
    );
    vi.mocked(readTargetMonth).mockResolvedValue('2026-08');

    const result = await getRunwayProjection(1, DEFAULT_NOW);

    expect(result.actual_runway_date).toBe('2026-08');
    expect(result.projections[0]!.installments).toBeGreaterThan(0);
  });

  // #552 — 페이스(실지출) 전망 상시 병기
  it('readAvgVariableMonthly 를 (userId, 3, 현재 결제월) 시그니처로 호출', async () => {
    vi.mocked(readDistributableAssetBalance).mockResolvedValue(1_000_000);
    // DEFAULT_NOW = 2026-04-10 21:00 KST → 현재 결제월 '2026-04'
    await getRunwayProjection(1, DEFAULT_NOW);
    expect(readAvgVariableMonthly).toHaveBeenCalledWith(1, 3, '2026-04');
  });

  it('pace_* 필드 + pace_projections 항상 존재 (target 유무 무관)', async () => {
    vi.mocked(readDistributableAssetBalance).mockResolvedValue(1_000_000);
    vi.mocked(readFixedCostsMonthlyTotal).mockResolvedValue(0);
    vi.mocked(readAvgVariableMonthly).mockResolvedValue(200_000);
    vi.mocked(readTargetMonth).mockResolvedValue('2026-06');

    const result = await getRunwayProjection(1, DEFAULT_NOW);

    expect(typeof result.pace_runway_months).toBe('number');
    expect(typeof result.pace_runway_date).toBe('string');
    expect(Array.isArray(result.pace_projections)).toBe(true);
    // 페이스는 avgVariableMonthly(200_000)를 자유 지출로 소진
    expect(result.pace_projections[0]!.free_budget).toBe(200_000);
  });

  it('target 있으면 plan_projections 채워지고 pace_projections 는 target 너머까지 이어짐', async () => {
    // 자유 예산이 커서 페이스 소진이 느림 → target(2026-06)보다 페이스가 더 오래 감.
    vi.mocked(readDistributableAssetBalance).mockResolvedValue(1_200_000);
    vi.mocked(readFixedCostsMonthlyTotal).mockResolvedValue(0);
    vi.mocked(readAvgVariableMonthly).mockResolvedValue(100_000); // 12개월치 페이스
    vi.mocked(readTargetMonth).mockResolvedValue('2026-06'); // 계획은 3개월

    const result = await getRunwayProjection(1, DEFAULT_NOW);

    // 계획 전망: allocator 배분 → target월(2026-06)에 수렴
    expect(result.plan_projections).not.toBeNull();
    expect(result.actual_runway_date).toBe('2026-06');
    // 페이스 전망: target과 독립 — 잔액이 target월 이후에도 이어짐 (동어반복 아님)
    expect(result.pace_projections.length).toBeGreaterThan(result.plan_projections!.length);
    expect(result.pace_runway_date > '2026-06').toBe(true);
  });

  it('target 없으면 plan_projections=null, actual_*=pace (하위호환)', async () => {
    vi.mocked(readDistributableAssetBalance).mockResolvedValue(1_000_000);
    vi.mocked(readFixedCostsMonthlyTotal).mockResolvedValue(0);
    vi.mocked(readAvgVariableMonthly).mockResolvedValue(200_000);
    vi.mocked(readTargetMonth).mockResolvedValue(null);

    const result = await getRunwayProjection(1, DEFAULT_NOW);

    expect(result.plan_projections).toBeNull();
    // actual_* 는 페이스와 동일해야 함 (target 없을 때 primary=pace)
    expect(result.actual_runway_months).toBe(result.pace_runway_months);
    expect(result.actual_runway_date).toBe(result.pace_runway_date);
    expect(result.projections).toEqual(result.pace_projections);
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
