import { describe, expect, it } from 'vitest';
import { projectRunway, projectFromAllocator } from '../runway-projection';
import type { MonthlyBudget } from '../../types-v2';

const BASE = {
  billingMonth: '2026-04',
  fixedMonthly: 500_000,
  installmentLockByMonth: new Map<string, number>(),
  plannedExpenses: [],
  freePerMonthEstimate: 300_000,
};

describe('projectRunway', () => {
  it('totalAvailable 0 → 빈 projections', () => {
    const { projections, actualRunwayMonths } = projectRunway({ ...BASE, totalAvailable: 0 });
    expect(projections).toHaveLength(0);
    expect(actualRunwayMonths).toBe(0);
  });

  it('잔고가 1개월 소진 미만 → remaining > 0 유지', () => {
    // netBurn = 800_000/월, 총 5개월 = 4_000_000
    const { projections } = projectRunway({ ...BASE, totalAvailable: 4_000_000 });
    expect(projections).toHaveLength(5);
    expect(projections.at(-1)!.remaining).toBe(0);
  });

  it('maxMonths 도달 전 소진 — actualRunwayMonths 소수점 계산', () => {
    // netBurn 800_000/월, 총 2_400_000 → 정확히 3개월
    const { projections, actualRunwayMonths } = projectRunway({
      ...BASE,
      totalAvailable: 2_400_000,
    });
    expect(projections).toHaveLength(3);
    expect(actualRunwayMonths).toBe(3);
  });

  it('잔고가 정확히 1.5개월치 — fraction 계산', () => {
    // netBurn 800_000/월, 총 1_200_000 → 1.5개월 소진
    const { actualRunwayMonths } = projectRunway({ ...BASE, totalAvailable: 1_200_000 });
    expect(actualRunwayMonths).toBe(1.5);
  });

  it('할부 만료 월 반영 — 만료 후 netBurn 감소', () => {
    // 할부 100_000/월 2회 (4·5월), billingMonth 2026-04
    // 4월: installment=100_000, 5월: installment=100_000, 6월: 0 (맵에 없음)
    const result = projectRunway({
      ...BASE,
      totalAvailable: 5_000_000,
      installmentLockByMonth: new Map([
        ['2026-04', 100_000],
        ['2026-05', 100_000],
      ]),
    });
    expect(result.projections[0]!.installments).toBe(100_000);
    expect(result.projections[1]!.installments).toBe(100_000);
    expect(result.projections[2]!.installments).toBe(0);
  });

  it('특정 월 planned 반영', () => {
    const result = projectRunway({
      ...BASE,
      totalAvailable: 5_000_000,
      plannedExpenses: [{ yearMonth: '2026-05', amount: 200_000 }],
    });
    expect(result.projections[0]!.locked).toBe(500_000); // 4월: fixed만
    expect(result.projections[1]!.locked).toBe(700_000); // 5월: fixed + planned
  });

  it('maxMonths 제한 준수', () => {
    const { projections } = projectRunway({
      ...BASE,
      totalAvailable: 999_999_999,
      maxMonths: 5,
    });
    expect(projections.length).toBeLessThanOrEqual(5);
  });
});

describe('projectFromAllocator', () => {
  it('allocator 결과 기반 projection — remaining이 target 끝에 0으로 수렴', () => {
    // sum(free) = 1_000_000 (라운딩 오차 포함)
    const monthlyBudgets: MonthlyBudget[] = [
      {
        yearMonth: '2026-04',
        allocatedDays: 6,
        fixed: 0,
        installments: 0,
        planned: 0,
        free: 46_875,
        isCurrent: true,
      },
      {
        yearMonth: '2026-05',
        allocatedDays: 30,
        fixed: 0,
        installments: 0,
        planned: 0,
        free: 234_375,
        isCurrent: false,
      },
      {
        yearMonth: '2026-06',
        allocatedDays: 31,
        fixed: 0,
        installments: 0,
        planned: 0,
        free: 242_188,
        isCurrent: false,
      },
      {
        yearMonth: '2026-07',
        allocatedDays: 30,
        fixed: 0,
        installments: 0,
        planned: 0,
        free: 234_375,
        isCurrent: false,
      },
      {
        yearMonth: '2026-08',
        allocatedDays: 31,
        fixed: 0,
        installments: 0,
        planned: 0,
        free: 242_187,
        isCurrent: false,
      },
    ];

    const { projections, actualRunwayDate } = projectFromAllocator(
      1_000_000,
      monthlyBudgets,
      '2026-04',
    );

    expect(projections).toHaveLength(5);
    expect(actualRunwayDate).toBe('2026-08');
    expect(projections.at(-1)!.remaining).toBeLessThanOrEqual(1); // 라운딩 오차만
  });

  it('잠긴돈이 자산 초과 — target 전에 소진', () => {
    const monthlyBudgets: MonthlyBudget[] = [
      {
        yearMonth: '2026-04',
        allocatedDays: 6,
        fixed: 500_000,
        installments: 0,
        planned: 0,
        free: 0,
        isCurrent: true,
      },
      {
        yearMonth: '2026-05',
        allocatedDays: 30,
        fixed: 500_000,
        installments: 0,
        planned: 0,
        free: 0,
        isCurrent: false,
      },
      {
        yearMonth: '2026-06',
        allocatedDays: 31,
        fixed: 500_000,
        installments: 0,
        planned: 0,
        free: 0,
        isCurrent: false,
      },
      {
        yearMonth: '2026-07',
        allocatedDays: 30,
        fixed: 500_000,
        installments: 0,
        planned: 0,
        free: 0,
        isCurrent: false,
      },
    ];

    const { projections } = projectFromAllocator(1_000_000, monthlyBudgets, '2026-04');

    expect(projections.length).toBeLessThan(4); // target 전 소진
    expect(projections.at(-1)!.remaining).toBe(0);
  });
});
