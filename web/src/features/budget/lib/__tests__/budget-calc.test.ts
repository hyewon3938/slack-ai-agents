import { describe, test, expect } from 'vitest';
import {
  addBillingMonths,
  getCurrentBillingMonth,
  getBillingRange,
  calcCycleDays,
  calculateBudgetAllocation,
  calculateTodayAllocation,
  resolveSnapshotDate,
} from '../budget-calc';
import type { BudgetCalcInput } from '../budget-calc';

// ─── 빌링 유틸리티 ──────────────────────────────────────────

describe('addBillingMonths', () => {
  test('오프셋 0 → 자기 자신', () => {
    expect(addBillingMonths('2026-04', 0)).toBe('2026-04');
  });

  test('양수 오프셋 → 미래 월', () => {
    expect(addBillingMonths('2026-04', 3)).toBe('2026-07');
  });

  test('연도 경계 넘기기 (12월 + 1)', () => {
    expect(addBillingMonths('2026-12', 1)).toBe('2027-01');
  });

  test('음수 오프셋 → 과거 월', () => {
    expect(addBillingMonths('2026-04', -1)).toBe('2026-03');
  });
});

describe('getCurrentBillingMonth', () => {
  test('15일 → 현재 월', () => {
    expect(getCurrentBillingMonth(new Date('2026-04-15T12:00:00'))).toBe('2026-04');
  });

  test('16일 → 다음 월', () => {
    expect(getCurrentBillingMonth(new Date('2026-04-16T12:00:00'))).toBe('2026-05');
  });

  test('1일 → 현재 월', () => {
    expect(getCurrentBillingMonth(new Date('2026-04-01T12:00:00'))).toBe('2026-04');
  });

  test('12월 16일 → 다음 해 1월', () => {
    expect(getCurrentBillingMonth(new Date('2026-12-16T12:00:00'))).toBe('2027-01');
  });

  test('31일 → 다음 월', () => {
    expect(getCurrentBillingMonth(new Date('2026-03-31T12:00:00'))).toBe('2026-04');
  });
});

describe('getBillingRange', () => {
  test('2026-04 → 2026-03-16 ~ 2026-04-15', () => {
    expect(getBillingRange('2026-04')).toEqual({ from: '2026-03-16', to: '2026-04-15' });
  });

  test('2026-01 → 2025-12-16 ~ 2026-01-15 (연도 경계)', () => {
    expect(getBillingRange('2026-01')).toEqual({ from: '2025-12-16', to: '2026-01-15' });
  });

  test('2026-12 → 2026-11-16 ~ 2026-12-15', () => {
    expect(getBillingRange('2026-12')).toEqual({ from: '2026-11-16', to: '2026-12-15' });
  });
});

describe('calcCycleDays', () => {
  test('3/16~4/15 → 31일', () => {
    expect(calcCycleDays('2026-03-16', '2026-04-15')).toBe(31);
  });

  test('2/16~3/15 → 28일 (평년)', () => {
    expect(calcCycleDays('2026-02-16', '2026-03-15')).toBe(28);
  });

  test('2/16~3/15 → 29일 (윤년 2028)', () => {
    expect(calcCycleDays('2028-02-16', '2028-03-15')).toBe(29);
  });

  test('같은 날 → 1일', () => {
    expect(calcCycleDays('2026-04-09', '2026-04-09')).toBe(1);
  });
});

// ─── calculateBudgetAllocation ──────────────────────────────

describe('calculateBudgetAllocation', () => {
  // 기본 테스트 입력: 2026-04 billing month, 목표 2026-08 (5개월)
  const baseInput: BudgetCalcInput = {
    totalAvailable: 1_000_000,
    fixedMonthly: 100_000,
    installments: [],
    plannedExpenses: [],
    billingMonth: '2026-04',
    targetDate: '2026-08',
    budgetDays: 9,      // 4/7 ~ 4/15 추적
    cycleDays: 31,      // 3/16 ~ 4/15
    flexibleSpent: 30_000,
    currentMonthIncome: 40_000,
  };

  test('budgetBase = totalAvailable + flexibleSpent - currentMonthIncome', () => {
    const result = calculateBudgetAllocation(baseInput);
    expect(result.budgetBase).toBe(1_000_000 + 30_000 - 40_000); // 990_000
  });

  test('targetDate null → freePerMonth null, 나머지 0', () => {
    const result = calculateBudgetAllocation({ ...baseInput, targetDate: null });
    expect(result.freePerMonth).toBeNull();
    expect(result.dailyFree).toBe(0);
    expect(result.totalLocked).toBe(0);
    expect(result.monthlyLocked).toHaveLength(0);
  });

  test('targetDate 현재 달보다 이전 → freePerMonth null', () => {
    const result = calculateBudgetAllocation({ ...baseInput, targetDate: '2026-03' });
    expect(result.freePerMonth).toBeNull();
  });

  test('targetDate = billingMonth → targetMonths = 1, monthlyLocked 1개', () => {
    const result = calculateBudgetAllocation({ ...baseInput, targetDate: '2026-04' });
    expect(result.monthlyLocked).toHaveLength(1);
    expect(result.freePerMonth).not.toBeNull();
  });

  test('현재 달 locked는 budgetDays/cycleDays 비율로 프로레이션', () => {
    const result = calculateBudgetAllocation(baseInput);
    // month 0: fixedMonthly=100_000, ratio=9/31
    const expectedMonth0Locked = Math.round(100_000 * (9 / 31)); // 29_032
    expect(result.monthlyLocked[0].total).toBe(100_000);
    // totalLocked의 첫 달 기여분 확인
    const month1to4Locked = result.monthlyLocked.slice(1).reduce((s, m) => s + m.total, 0);
    expect(result.totalLocked).toBe(expectedMonth0Locked + month1to4Locked);
  });

  test('신규 할부(isNew=true)는 month 0에서 locked 제외', () => {
    const input: BudgetCalcInput = {
      ...baseInput,
      installments: [{ amount: 10_000, remaining: 3, isNew: true }],
    };
    const result = calculateBudgetAllocation(input);
    // month 0: isNew → 제외
    expect(result.monthlyLocked[0].installments).toBe(0);
    // month 1: remaining(3) > 1, isNew 제외 조건 없음 → 포함
    expect(result.monthlyLocked[1].installments).toBe(10_000);
    // month 3: remaining(3) > 3 → false → 제외
    expect(result.monthlyLocked[3].installments).toBe(0);
  });

  test('구 할부(isNew=false)는 month 0에서도 locked 포함', () => {
    const input: BudgetCalcInput = {
      ...baseInput,
      installments: [{ amount: 10_000, remaining: 3, isNew: false }],
    };
    const result = calculateBudgetAllocation(input);
    expect(result.monthlyLocked[0].installments).toBe(10_000);
    expect(result.monthlyLocked[1].installments).toBe(10_000);
    expect(result.monthlyLocked[3].installments).toBe(0); // remaining 3 → months 0,1,2만
  });

  test('freePerMonth = round(dailyFree * cycleDays)', () => {
    const result = calculateBudgetAllocation(baseInput);
    expect(result.freePerMonth).toBe(Math.round(result.dailyFree * baseInput.cycleDays));
  });

  test('수입이 있으면 budgetBase 감소 → freePerMonth 감소', () => {
    const noIncome = calculateBudgetAllocation({ ...baseInput, currentMonthIncome: 0 });
    const withIncome = calculateBudgetAllocation({ ...baseInput, currentMonthIncome: 50_000 });
    expect(withIncome.freePerMonth!).toBeLessThan(noIncome.freePerMonth!);
  });

  test('잠긴 돈이 budgetBase 초과 → freePerMonth = 0 (음수 안 됨)', () => {
    const input: BudgetCalcInput = { ...baseInput, totalAvailable: 10_000, fixedMonthly: 500_000 };
    const result = calculateBudgetAllocation(input);
    expect(result.freePerMonth).toBeGreaterThanOrEqual(0);
    expect(result.dailyFree).toBeGreaterThanOrEqual(0);
  });

  test('예정 지출이 있으면 해당 월 locked에 포함', () => {
    const input: BudgetCalcInput = {
      ...baseInput,
      plannedExpenses: [{ year_month: '2026-05', amount: 50_000 }],
    };
    const result = calculateBudgetAllocation(input);
    // month 1 = '2026-05'
    expect(result.monthlyLocked[1].planned).toBe(50_000);
    expect(result.monthlyLocked[0].planned).toBe(0);
  });

  test('monthlyLocked days: month 0 = budgetDays, 나머지 = 해당 월 일수', () => {
    const result = calculateBudgetAllocation(baseInput);
    expect(result.monthlyLocked[0].days).toBe(baseInput.budgetDays); // 9
    // month 1 = '2026-05': 4/16 ~ 5/15 → 30일
    expect(result.monthlyLocked[1].days).toBe(30);
    // month 2 = '2026-06': 5/16 ~ 6/15 → 31일
    expect(result.monthlyLocked[2].days).toBe(31);
  });
});

// ─── calculateTodayAllocation ──────────────────────────────
//
// 핵심 버그 재현:
//   - 이번 달이 이미 초과된 상태(monthBudgetRemaining < 0)에서
//     오늘 예산이 음수로 나와 "오늘 초과 = 오늘 지출 + 이전 누적 빚"이 되어버림.
//   - 사용자는 오늘 49680원 썼는데 오늘 초과 53103원으로 표시됨 (-3423 carry-over 포함).
//   - 카피라이트: 오늘 예산은 0원으로 클램프하고, 오늘 초과는 순수하게 오늘 지출만 반영.

describe('calculateTodayAllocation', () => {
  test('정상 케이스: 남은 예산 양수 → 균등 분배', () => {
    const result = calculateTodayAllocation({
      monthBudgetRemaining: 40_000,
      todayFlexSpent: 10_000,
      cycleRemainingDays: 3, // 오늘 포함 4일
    });
    // budgetBeforeToday = 40000 + 10000 = 50000
    // todayBudget = 50000 / 4 = 12500
    expect(result.todayBudget).toBe(12_500);
    expect(result.todayRemaining).toBe(2_500); // 12500 - 10000
  });

  test('오늘 아직 지출 없음 → 예산 = 남은예산 / 남은일수', () => {
    const result = calculateTodayAllocation({
      monthBudgetRemaining: 40_000,
      todayFlexSpent: 0,
      cycleRemainingDays: 3,
    });
    expect(result.todayBudget).toBe(10_000);
    expect(result.todayRemaining).toBe(10_000);
  });

  test('주기 마지막 날(cycleRemainingDays=0) → todayIncludedDays=1', () => {
    const result = calculateTodayAllocation({
      monthBudgetRemaining: 20_000,
      todayFlexSpent: 5_000,
      cycleRemainingDays: 0,
    });
    // budgetBeforeToday = 25000, 1일에 전부
    expect(result.todayBudget).toBe(25_000);
    expect(result.todayRemaining).toBe(20_000);
  });

  test('🐛 bug fix: 이번 달이 이미 초과된 상태에서 오늘 예산은 0으로 클램프', () => {
    // 실제 재현 값: monthRemaining=-63372, todayFlexSpent=49680, cycleRemainingDays=3
    // budgetBeforeToday = -63372 + 49680 = -13692 → 예전엔 -3423원/day → today_remaining -53103
    const result = calculateTodayAllocation({
      monthBudgetRemaining: -63_372,
      todayFlexSpent: 49_680,
      cycleRemainingDays: 3,
    });
    expect(result.todayBudget).toBe(0);
    // 오늘 초과 = 오늘 지출 그대로 (이전 누적 빚은 분리)
    expect(result.todayRemaining).toBe(-49_680);
  });

  test('🐛 bug fix: 월 초과 + 오늘 미지출 → 오늘 예산 0, 남음 0', () => {
    const result = calculateTodayAllocation({
      monthBudgetRemaining: -13_692,
      todayFlexSpent: 0,
      cycleRemainingDays: 3,
    });
    expect(result.todayBudget).toBe(0);
    expect(result.todayRemaining).toBe(0);
  });

  test('cycleRemainingDays 음수 방어 → 에러 안 나고 0 또는 양수', () => {
    const result = calculateTodayAllocation({
      monthBudgetRemaining: 10_000,
      todayFlexSpent: 0,
      cycleRemainingDays: -1,
    });
    // todayIncludedDays 방어: 최소 1
    expect(result.todayBudget).toBeGreaterThanOrEqual(0);
  });
});

// ─── resolveSnapshotDate ──────────────────────────────
//
// 핵심 버그 재현:
//   - Vercel cron `50 14 * * *` (14:50 UTC = 23:50 KST) 로 예약했지만
//     실제 fire는 15:03:19 UTC (드리프트 13분) → KST 00:03 → getTodayISO()가
//     다음날 반환 → 스냅샷이 다음날 date로 저장되는 문제.
//   - 해결: nowUtc에서 1시간 버퍼를 뺀 anchor 시점의 KST 날짜를 반환.

describe('resolveSnapshotDate', () => {
  test('정시 발화 (14:50 UTC) → KST 23:50 → 당일(KST)', () => {
    const now = new Date('2026-04-11T14:50:00Z');
    expect(resolveSnapshotDate(now)).toBe('2026-04-11');
  });

  test('🐛 실제 재현: 14:50 예약 → 15:03 UTC fire → 여전히 KST 당일(4/11)', () => {
    const now = new Date('2026-04-11T15:03:19Z');
    expect(resolveSnapshotDate(now)).toBe('2026-04-11');
  });

  test('드리프트 30분 → 여전히 당일', () => {
    const now = new Date('2026-04-11T15:20:00Z');
    expect(resolveSnapshotDate(now)).toBe('2026-04-11');
  });

  test('드리프트 50분 → 여전히 당일 (1시간 버퍼 내)', () => {
    const now = new Date('2026-04-11T15:40:00Z');
    expect(resolveSnapshotDate(now)).toBe('2026-04-11');
  });

  test('월말 경계: 4/30 23:50 KST 예약 → 정상 발화 → 4/30', () => {
    const now = new Date('2026-04-30T14:50:00Z');
    expect(resolveSnapshotDate(now)).toBe('2026-04-30');
  });

  test('월말 경계: 4/30 14:50 예약 → 15:10 드리프트 → 여전히 4/30', () => {
    const now = new Date('2026-04-30T15:10:00Z');
    expect(resolveSnapshotDate(now)).toBe('2026-04-30');
  });

  test('연말 경계: 12/31 23:50 KST 정시 발화 → 12/31', () => {
    const now = new Date('2026-12-31T14:50:00Z');
    expect(resolveSnapshotDate(now)).toBe('2026-12-31');
  });

  test('명시적 KST 정오 → 당일 그대로 (버퍼 차감해도 같은 날)', () => {
    // 12:00 KST = 03:00 UTC → anchor 02:00 UTC → 11:00 KST 같은 날
    const now = new Date('2026-04-11T03:00:00Z');
    expect(resolveSnapshotDate(now)).toBe('2026-04-11');
  });
});
