import { describe, test, expect } from 'vitest';
import {
  addBillingMonths,
  getCurrentBillingMonth,
  getBillingRange,
  calcCycleDays,
  calculateBudgetAllocation,
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
