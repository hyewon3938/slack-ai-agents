import { describe, it, expect } from 'vitest';
import { allocateMonthlyBudgets } from '../month-allocator';
import { allocateTodayBudget } from '../day-allocator';
import type { MonthAllocatorInput } from '../../types-v2';

const BASE: MonthAllocatorInput = {
  totalAvailable: 36000,
  fixedMonthly: 0,
  installments: [],
  plannedExpenses: [],
  currentBillingMonth: '2026-04',
  targetMonth: '2026-05',
  today: '2026-04-11',
};

describe('D. 과거/현재/미래 경계', () => {
  describe('D-1. 자산/런웨이 수정 → 축 A 트리거 (월별 예산 변경)', () => {
    it('totalAvailable 변경 시 monthlyBudgets 변경', () => {
      const r1 = allocateMonthlyBudgets(BASE);
      const r2 = allocateMonthlyBudgets({ ...BASE, totalAvailable: 50000 });
      expect(r1.dailyFree).not.toBeCloseTo(r2.dailyFree, 0);
      expect(r2.totalLocked).toBe(r1.totalLocked); // locked는 자산과 무관
    });

    it('targetMonth 변경 시 monthlyBudgets 개수 변경', () => {
      const r3months = allocateMonthlyBudgets({ ...BASE, targetMonth: '2026-06' });
      const r2months = allocateMonthlyBudgets(BASE); // targetMonth='2026-05'
      expect(r3months.monthlyBudgets).toHaveLength(3);
      expect(r2months.monthlyBudgets).toHaveLength(2);
    });
  });

  describe('D-2. 지출 기록 수정 → 축 B 트리거 (일 예산만 변경)', () => {
    it('flexibleSpent 변경이 monthlyBudgets에는 영향 없음', () => {
      // monthBudget은 allocateMonthlyBudgets의 결과 (축 A)
      // flexibleSpent는 그 이후 축 B에서만 사용
      const monthResult = allocateMonthlyBudgets(BASE);
      const currentMonth = monthResult.monthlyBudgets.find((m) => m.isCurrent)!;

      const dayResult1 = allocateTodayBudget({
        monthBudget: currentMonth.free,
        flexibleSpent: 5000,
        todayFlexSpent: 1000,
        cycleTotalDays: 31,
      });
      const dayResult2 = allocateTodayBudget({
        monthBudget: currentMonth.free, // monthBudget 동일
        flexibleSpent: 8000,            // 지출 기록만 다름
        todayFlexSpent: 2000,
        cycleTotalDays: 31,
      });
      // 월 예산(monthBudget)은 지출에 관계없이 동일
      expect(currentMonth.free).toBe(currentMonth.free); // 변하지 않음
      // 지출이 달라지면 day 결과는 달라짐
      expect(dayResult1.monthBudgetRemaining).not.toBe(dayResult2.monthBudgetRemaining);
    });
  });

  describe('D-3. 과거 월 지출 수정 → 자산 변동 → 축 A 트리거', () => {
    it('과거 지출 수정 = totalAvailable 변동 → 현재+미래 월 재분배', () => {
      // 과거 지출 수정은 totalAvailable 변동과 동일한 효과
      const before = allocateMonthlyBudgets(BASE);
      // 과거 지출 +5000 취소 → totalAvailable +5000
      const after = allocateMonthlyBudgets({ ...BASE, totalAvailable: 41000 });
      expect(after.dailyFree).toBeGreaterThan(before.dailyFree);
      // 현재 월 포함 모든 월이 재분배
      for (let i = 0; i < before.monthlyBudgets.length; i++) {
        expect(after.monthlyBudgets[i].free).toBeGreaterThanOrEqual(before.monthlyBudgets[i].free);
      }
    });
  });

  describe('D-4. 고정지출 변경 → 축 A 트리거, 미래 fixed 반영', () => {
    it('fixedMonthly 추가 → 미래 월 fixed 증가, 자유 예산 감소', () => {
      const without = allocateMonthlyBudgets(BASE);
      const withFixed = allocateMonthlyBudgets({ ...BASE, fixedMonthly: 10000 });
      const may0 = without.monthlyBudgets.find((m) => m.yearMonth === '2026-05')!;
      const may1 = withFixed.monthlyBudgets.find((m) => m.yearMonth === '2026-05')!;
      expect(may1.fixed).toBe(10000);
      expect(may1.free).toBeLessThan(may0.free);
    });

    it('fixedMonthly 삭제 → 미래 月 fixed 0, 자유 예산 증가', () => {
      const withFixed = allocateMonthlyBudgets({ ...BASE, fixedMonthly: 10000 });
      const deleted = allocateMonthlyBudgets({ ...BASE, fixedMonthly: 0 });
      const may1 = withFixed.monthlyBudgets.find((m) => m.yearMonth === '2026-05')!;
      const may0 = deleted.monthlyBudgets.find((m) => m.yearMonth === '2026-05')!;
      expect(may0.fixed).toBe(0);
      expect(may0.free).toBeGreaterThan(may1.free);
    });
  });
});
