import { describe, it, expect } from 'vitest';
import { allocateMonthlyBudgets } from '../month-allocator';
import type { MonthAllocatorInput } from '../../types-v2';

// today: 2026-04-11 → 현재 주기 03-16~04-15 (31일), 남은 5일
const BASE: MonthAllocatorInput = {
  totalAvailable: 36000,
  fixedMonthly: 0,
  installments: [],
  plannedExpenses: [],
  currentBillingMonth: '2026-04',
  targetMonth: '2026-05',
  today: '2026-04-11',
};

describe('B. 월 배분 (allocateMonthlyBudgets)', () => {
  describe('B-1. 목표 미설정', () => {
    it('targetMonth null → monthlyBudgets 빈 배열, freePerMonth null', () => {
      const result = allocateMonthlyBudgets({ ...BASE, targetMonth: null });
      expect(result.monthlyBudgets).toEqual([]);
      expect(result.freePerMonth).toBeNull();
      expect(result.dailyFree).toBe(0);
      expect(result.totalLocked).toBe(0);
    });
  });

  describe('B-2. 목표 = 당월 → 단일 月, 프로레이션', () => {
    it('당월만 존재, allocatedDays = 남은 5일', () => {
      const result = allocateMonthlyBudgets({ ...BASE, targetMonth: '2026-04' });
      expect(result.monthlyBudgets).toHaveLength(1);
      const apr = result.monthlyBudgets[0];
      expect(apr.yearMonth).toBe('2026-04');
      expect(apr.allocatedDays).toBe(5);
      expect(apr.isCurrent).toBe(true);
      expect(apr.free).toBe(36000); // totalAvailable 전부 자유 예산
    });
  });

  describe('B-3. 자산 증가 → 전 월 자유 예산 비례 증가', () => {
    it('totalAvailable 2배 → dailyFree 2배', () => {
      const r1 = allocateMonthlyBudgets(BASE);
      const r2 = allocateMonthlyBudgets({ ...BASE, totalAvailable: 72000 });
      expect(r2.dailyFree).toBeCloseTo(r1.dailyFree * 2, 5);
      // 미래 월도 비례 증가
      const may1 = r1.monthlyBudgets.find((m) => m.yearMonth === '2026-05')!;
      const may2 = r2.monthlyBudgets.find((m) => m.yearMonth === '2026-05')!;
      expect(may2.free).toBe(may1.free * 2);
    });
  });

  describe('B-4. 자산 감소 → 현재 월도 남은 일수 기준 감소', () => {
    it('totalAvailable 절반 → 현재 월 free도 절반', () => {
      const r1 = allocateMonthlyBudgets(BASE);
      const r2 = allocateMonthlyBudgets({ ...BASE, totalAvailable: 18000 });
      const apr1 = r1.monthlyBudgets.find((m) => m.yearMonth === '2026-04')!;
      const apr2 = r2.monthlyBudgets.find((m) => m.yearMonth === '2026-04')!;
      expect(apr2.free).toBe(apr1.free / 2);
    });
  });

  describe('B-5. 동일 targetMonth 재저장 시 결과 동일 (추적 시작일 리셋 없음)', () => {
    it('순수 함수 — 같은 입력 = 같은 결과', () => {
      const r1 = allocateMonthlyBudgets(BASE);
      const r2 = allocateMonthlyBudgets(BASE);
      expect(r1).toEqual(r2);
    });
  });

  describe('B-6. 런웨이 목표가 과거 → 빈 결과 반환', () => {
    it('targetMonth < currentBillingMonth → monthlyBudgets 빈 배열', () => {
      const result = allocateMonthlyBudgets({ ...BASE, targetMonth: '2026-01' });
      expect(result.monthlyBudgets).toEqual([]);
      expect(result.freePerMonth).toBeNull();
    });
  });

  describe('고정비 프로레이션', () => {
    it('현재 월 fixed는 남은 일수(5/31) 기준, 미래 월은 전체', () => {
      // fixedMonthly=31000이면 현재 월 locked = round(31000 * 5/31) = 5000
      const result = allocateMonthlyBudgets({
        ...BASE,
        fixedMonthly: 31000,
        totalAvailable: 90000,
        targetMonth: '2026-05',
      });
      const apr = result.monthlyBudgets.find((m) => m.yearMonth === '2026-04')!;
      const may = result.monthlyBudgets.find((m) => m.yearMonth === '2026-05')!;
      expect(apr.fixed).toBe(5000);
      expect(may.fixed).toBe(31000);
      // totalLocked = 5000 + 31000 = 36000
      expect(result.totalLocked).toBe(36000);
    });
  });

  describe('예정 지출', () => {
    it('해당 월에만 planned 반영', () => {
      const result = allocateMonthlyBudgets({
        ...BASE,
        plannedExpenses: [{ yearMonth: '2026-05', amount: 5000 }],
        totalAvailable: 77000,
        targetMonth: '2026-05',
      });
      const apr = result.monthlyBudgets.find((m) => m.yearMonth === '2026-04')!;
      const may = result.monthlyBudgets.find((m) => m.yearMonth === '2026-05')!;
      expect(apr.planned).toBe(0);
      expect(may.planned).toBe(5000);
    });
  });
});
