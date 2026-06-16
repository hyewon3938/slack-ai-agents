import { describe, it, expect } from 'vitest';
import { allocateMonthlyBudgets } from '../month-allocator';
import type { MonthAllocatorInput } from '../../types-v2';

const BASE: MonthAllocatorInput = {
  totalAvailable: 90000,
  fixedMonthly: 0,
  installmentLockByMonth: new Map(),
  plannedExpenses: [],
  currentBillingMonth: '2026-04',
  targetMonth: '2026-06', // 3개월: Apr, May, Jun
  today: '2026-04-11', // Apr 주기: 03-14~04-13 (31일)
};

describe('F. 엣지 케이스', () => {
  describe('F-1. 묶인 돈 — 창 안 현재/미래 월 모두 reservation (#539)', () => {
    it('현재월 할부 → 현재 월 전액 포함 (ratio=1)', () => {
      const result = allocateMonthlyBudgets({
        ...BASE,
        installmentLockByMonth: new Map([['2026-04', 10000]]),
      });
      const apr = result.monthlyBudgets.find((m) => m.yearMonth === '2026-04')!;
      expect(apr.installments).toBe(10000);
    });

    it('창 안 미래월 할부 → 그 달에 reservation (등록시점 차감 특례 폐지)', () => {
      const result = allocateMonthlyBudgets({
        ...BASE,
        installmentLockByMonth: new Map([
          ['2026-04', 10000],
          ['2026-05', 10000],
          ['2026-06', 10000],
        ]),
      });
      const apr = result.monthlyBudgets.find((m) => m.yearMonth === '2026-04')!;
      const may = result.monthlyBudgets.find((m) => m.yearMonth === '2026-05')!;
      const jun = result.monthlyBudgets.find((m) => m.yearMonth === '2026-06')!;
      expect(apr.installments).toBe(10000);
      expect(may.installments).toBe(10000);
      expect(jun.installments).toBe(10000);
    });

    it('totalLocked = 창 안 모든 할부 합 (현재월+미래월)', () => {
      const result = allocateMonthlyBudgets({
        ...BASE,
        installmentLockByMonth: new Map([
          ['2026-04', 10000],
          ['2026-05', 10000],
        ]),
      });
      // 현재월 10000 + 미래월 10000 (fixed/planned 0)
      expect(result.totalLocked).toBe(20000);
    });
  });

  describe('F-2. 수입 분배 플래그 — distribute_to_budget 처리', () => {
    it('distribute_to_budget=true → 수입이 totalAvailable에 반영됨', () => {
      // 수입 10000을 전체 기간 분배(distribute=true):
      // facade가 totalAvailable에 10000을 포함하여 allocator에 전달
      const withIncome = allocateMonthlyBudgets({ ...BASE, totalAvailable: 100000 });
      const withoutIncome = allocateMonthlyBudgets({ ...BASE, totalAvailable: 90000 });
      // 수입이 반영되면 전체 자유 예산 증가
      expect(withIncome.dailyFree).toBeGreaterThan(withoutIncome.dailyFree);
    });

    it('distribute_to_budget=false → 수입이 totalAvailable에서 제외됨 (현재 월에만)', () => {
      // facade가 현재 월 자유 예산에 직접 반영 (allocator에는 제외된 totalAvailable 전달)
      // allocator 결과는 totalAvailable 차이만큼 다름
      const excluded = allocateMonthlyBudgets({ ...BASE, totalAvailable: 90000 });
      const included = allocateMonthlyBudgets({ ...BASE, totalAvailable: 100000 });
      // allocator 레벨에서는 totalAvailable로 통일 — facade가 결정
      expect(included.totalLocked).toBe(excluded.totalLocked); // locked 동일
      expect(included.dailyFree).toBeGreaterThan(excluded.dailyFree);
    });
  });
});
