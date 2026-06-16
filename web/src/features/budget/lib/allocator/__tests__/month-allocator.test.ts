import { describe, it, expect } from 'vitest';
import { allocateMonthlyBudgets } from '../month-allocator';
import type { MonthAllocatorInput } from '../../types-v2';

// today: 2026-04-11 → 현재 주기 03-15~04-14 (31일)
const BASE: MonthAllocatorInput = {
  totalAvailable: 36000,
  fixedMonthly: 0,
  installmentLockByMonth: new Map(),
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

  describe('B-2. 목표 = 당월 → 단일 月', () => {
    it('당월만 존재, allocatedDays = 전체 주기(31일)', () => {
      const result = allocateMonthlyBudgets({ ...BASE, targetMonth: '2026-04' });
      expect(result.monthlyBudgets).toHaveLength(1);
      const apr = result.monthlyBudgets[0];
      expect(apr.yearMonth).toBe('2026-04');
      expect(apr.allocatedDays).toBe(31);
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

  describe('B-4. 자산 감소 → 전 월 자유 예산 비례 감소', () => {
    it('totalAvailable 절반 → dailyFree 절반, free 비례 감소', () => {
      // sumDays = 31(Apr) + 30(May 주기: 04-14~05-13) = 61
      // 61000 → dailyFree=1000, Apr=31000, May=30000
      // 30500 → dailyFree=500, Apr=15500, May=15000
      const r1 = allocateMonthlyBudgets({ ...BASE, totalAvailable: 61000 });
      const r2 = allocateMonthlyBudgets({ ...BASE, totalAvailable: 30500 });
      expect(r2.dailyFree).toBeCloseTo(r1.dailyFree / 2, 5);
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

  describe('고정비 — 현재 월도 전액 반영 (ratio=1)', () => {
    it('현재 월/미래 월 모두 fixed 전액 반영', () => {
      // fixedMonthly=31000이면 현재 월 locked = round(31000 * 1) = 31000
      const result = allocateMonthlyBudgets({
        ...BASE,
        fixedMonthly: 31000,
        totalAvailable: 90000,
        targetMonth: '2026-05',
      });
      const apr = result.monthlyBudgets.find((m) => m.yearMonth === '2026-04')!;
      const may = result.monthlyBudgets.find((m) => m.yearMonth === '2026-05')!;
      expect(apr.fixed).toBe(31000);
      expect(may.fixed).toBe(31000);
      // totalLocked = 31000 + 31000 = 62000
      expect(result.totalLocked).toBe(62000);
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

  describe('이번 달 전용 수입 (currentMonthOnlyIncome bonus)', () => {
    it('미설정(undefined) → 기본 동작과 동일', () => {
      const r1 = allocateMonthlyBudgets({ ...BASE, totalAvailable: 35000 });
      const r2 = allocateMonthlyBudgets({
        ...BASE,
        totalAvailable: 35000,
        currentMonthOnlyIncome: undefined,
      });
      expect(r1).toEqual(r2);
    });

    it('0 → 기본 동작과 동일', () => {
      const r1 = allocateMonthlyBudgets({ ...BASE, totalAvailable: 35000 });
      const r2 = allocateMonthlyBudgets({
        ...BASE,
        totalAvailable: 35000,
        currentMonthOnlyIncome: 0,
      });
      expect(r1).toEqual(r2);
    });

    it('양수 bonus → 현재 월 free 에만 귀속, 미래 월 dailyFree 감소', () => {
      // sumDays=61, totalAvailable=35000, bonus=3500
      // totalFree=31500, dailyFree=31500/61≈516.39
      // apr=round(516.39*31)+3500=16008+3500=19508, may=round(516.39*30)=15492
      const result = allocateMonthlyBudgets({
        ...BASE,
        totalAvailable: 35000,
        currentMonthOnlyIncome: 3500,
      });
      const apr = result.monthlyBudgets.find((m) => m.yearMonth === '2026-04')!;
      const may = result.monthlyBudgets.find((m) => m.yearMonth === '2026-05')!;
      expect(apr.free).toBe(19508);
      expect(may.free).toBe(15492);
      expect(apr.free + may.free).toBe(35000); // 중복 없음 — 총합 = totalAvailable
    });

    it('bonus 추가 시 미래 월 free 는 bonus 없을 때보다 감소', () => {
      const base = allocateMonthlyBudgets({ ...BASE, totalAvailable: 35000 });
      const withBonus = allocateMonthlyBudgets({
        ...BASE,
        totalAvailable: 35000,
        currentMonthOnlyIncome: 3500,
      });
      const baseMay = base.monthlyBudgets.find((m) => m.yearMonth === '2026-05')!;
      const bonusMay = withBonus.monthlyBudgets.find((m) => m.yearMonth === '2026-05')!;
      expect(bonusMay.free).toBeLessThan(baseMay.free);
    });

    it('bonus > totalAvailable → totalFree 0 으로 클램프, 현재 월 free = bonus', () => {
      // totalAvailable=10000, bonus=50000 → totalFree=max(0, 10000-50000)=0, dailyFree=0
      // apr=0+50000=50000, may=0
      const result = allocateMonthlyBudgets({
        ...BASE,
        totalAvailable: 10000,
        currentMonthOnlyIncome: 50000,
      });
      const apr = result.monthlyBudgets.find((m) => m.yearMonth === '2026-04')!;
      const may = result.monthlyBudgets.find((m) => m.yearMonth === '2026-05')!;
      expect(apr.free).toBe(50000);
      expect(may.free).toBe(0);
    });

    it('targetMonth null → bonus 무시 (monthlyBudgets 빈 배열)', () => {
      const result = allocateMonthlyBudgets({
        ...BASE,
        targetMonth: null,
        currentMonthOnlyIncome: 5000,
      });
      expect(result.monthlyBudgets).toEqual([]);
    });

    it('음수 bonus → 0 으로 클램프 (방어적)', () => {
      const neg = allocateMonthlyBudgets({
        ...BASE,
        totalAvailable: 35000,
        currentMonthOnlyIncome: -1000,
      });
      const zero = allocateMonthlyBudgets({
        ...BASE,
        totalAvailable: 35000,
        currentMonthOnlyIncome: 0,
      });
      expect(neg).toEqual(zero);
    });
  });

  describe('묶인 돈 = 목표기간 창 월별 할부 락 (#539)', () => {
    it('현재월 할부 → 현재월 락에 포함 (1회차도 동일, ratio=1)', () => {
      const result = allocateMonthlyBudgets({
        ...BASE,
        totalAvailable: 35000,
        installmentLockByMonth: new Map([['2026-04', 1000]]),
      });
      const apr = result.monthlyBudgets.find((m) => m.yearMonth === '2026-04')!;
      expect(apr.installments).toBe(1000);
    });

    it('미래월 할부 → 그 달 락에 포함, 현재월은 0 (등록시점 차감 특례 없음)', () => {
      const result = allocateMonthlyBudgets({
        ...BASE,
        totalAvailable: 35000,
        installmentLockByMonth: new Map([['2026-05', 1000]]),
      });
      const apr = result.monthlyBudgets.find((m) => m.yearMonth === '2026-04')!;
      const may = result.monthlyBudgets.find((m) => m.yearMonth === '2026-05')!;
      expect(apr.installments).toBe(0);
      expect(may.installments).toBe(1000);
    });

    it('현재월+미래월 동시 → 각 달이 자기 billing_month 락을 받음', () => {
      const result = allocateMonthlyBudgets({
        ...BASE,
        totalAvailable: 35000,
        installmentLockByMonth: new Map([
          ['2026-04', 1000],
          ['2026-05', 2000],
        ]),
      });
      const apr = result.monthlyBudgets.find((m) => m.yearMonth === '2026-04')!;
      const may = result.monthlyBudgets.find((m) => m.yearMonth === '2026-05')!;
      expect(apr.installments).toBe(1000);
      expect(may.installments).toBe(2000);
      expect(result.totalLocked).toBe(3000); // fixed 0 + planned 0 + 할부 3000
    });

    it('창 밖(target 이후) 월 키는 무시 — allocator가 순회하지 않음', () => {
      // target=2026-05라 2026-06은 순회 대상 아님. 맵에 있어도 어떤 달에도 안 잡힘.
      const result = allocateMonthlyBudgets({
        ...BASE,
        totalAvailable: 35000,
        installmentLockByMonth: new Map([['2026-06', 9999]]),
      });
      const apr = result.monthlyBudgets.find((m) => m.yearMonth === '2026-04')!;
      const may = result.monthlyBudgets.find((m) => m.yearMonth === '2026-05')!;
      expect(apr.installments).toBe(0);
      expect(may.installments).toBe(0);
      expect(result.totalLocked).toBe(0);
    });

    it('빈 락 맵 → 모든 월 installments 0', () => {
      const result = allocateMonthlyBudgets({
        ...BASE,
        totalAvailable: 35000,
        installmentLockByMonth: new Map(),
      });
      for (const mb of result.monthlyBudgets) expect(mb.installments).toBe(0);
    });
  });

  describe('B-7. today가 달라도 결과 동일 (대금기간 내 고정 예산)', () => {
    it('대금기간 내 다른 날짜여도 allocatedDays/monthlyBudgets 동일', () => {
      const r1 = allocateMonthlyBudgets({ ...BASE, today: '2026-03-17' });
      const r2 = allocateMonthlyBudgets({ ...BASE, today: '2026-04-10' });
      expect(r1).toEqual(r2);
    });
  });
});
