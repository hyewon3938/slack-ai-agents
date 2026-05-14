import { describe, it, expect } from 'vitest';
import { allocateMonthlyBudgets } from '../month-allocator';
import type { MonthAllocatorInput } from '../../types-v2';

const BASE: MonthAllocatorInput = {
  totalAvailable: 90000,
  fixedMonthly: 0,
  installments: [],
  plannedExpenses: [],
  currentBillingMonth: '2026-04',
  targetMonth: '2026-06', // 3개월: Apr, May, Jun
  today: '2026-04-11', // Apr 주기: 03-14~04-13 (31일)
};

describe('F. 엣지 케이스', () => {
  describe('F-1. 신규 할부 (isNew) — 현재 월 locked 제외, 미래 월만 포함', () => {
    it('isNew=false → 현재 월도 전액 포함 (ratio=1)', () => {
      const result = allocateMonthlyBudgets({
        ...BASE,
        installments: [{ monthlyAmount: 10000, remainingCount: 3, isNew: false }],
      });
      const apr = result.monthlyBudgets.find((m) => m.yearMonth === '2026-04')!;
      // round(10000 * 1) = 10000
      expect(apr.installments).toBe(10000);
    });

    it('isNew=true → 현재 월/미래 월 모두 installments=0 (ADR 0015: 미래 월 INSERT 즉시 자산 차감)', () => {
      const result = allocateMonthlyBudgets({
        ...BASE,
        installments: [{ monthlyAmount: 10000, remainingCount: 3, isNew: true }],
      });
      const apr = result.monthlyBudgets.find((m) => m.yearMonth === '2026-04')!;
      const may = result.monthlyBudgets.find((m) => m.yearMonth === '2026-05')!;
      const jun = result.monthlyBudgets.find((m) => m.yearMonth === '2026-06')!;
      expect(apr.installments).toBe(0); // 현재 월 isNew=true 제외 (자유지출에 잡힘)
      expect(may.installments).toBe(0); // 미래 월 — ADR 0015로 자산 차감 완료
      expect(jun.installments).toBe(0); // 미래 월 — ADR 0015로 자산 차감 완료
    });

    it('isNew=true vs isNew=false — totalLocked 차이는 현재 월 할부 전액 (미래 월은 양쪽 모두 0)', () => {
      const rOld = allocateMonthlyBudgets({
        ...BASE,
        installments: [{ monthlyAmount: 10000, remainingCount: 3, isNew: false }],
      });
      const rNew = allocateMonthlyBudgets({
        ...BASE,
        installments: [{ monthlyAmount: 10000, remainingCount: 3, isNew: true }],
      });
      // 현재 월: isNew=false→10000, isNew=true→0. 미래 월: 양쪽 모두 0.
      expect(rOld.totalLocked - rNew.totalLocked).toBe(10000);
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
