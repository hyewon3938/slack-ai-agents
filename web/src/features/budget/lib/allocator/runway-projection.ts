import { addBillingMonths } from '../billing/cycle';
import type { MonthlyBudget } from '../types-v2';

export interface ProjectionPlannedInput {
  yearMonth: string;
  amount: number;
}

export interface RunwayProjectionInput {
  billingMonth: string;
  totalAvailable: number;
  fixedMonthly: number;
  /** billing_month별 할부 락 (#539). 월별 .get(month)으로 그 달 할부 burn 조회. */
  installmentLockByMonth: Map<string, number>;
  plannedExpenses: ProjectionPlannedInput[];
  /** freePerMonth ?? avgVariableMonthly */
  freePerMonthEstimate: number;
  maxMonths?: number;
}

export interface MonthProjection {
  month: string;
  fixed: number;
  installments: number;
  locked: number;
  free_budget: number;
  income: number;
  net_burn: number;
  remaining: number;
}

export interface RunwayProjectionResult {
  projections: MonthProjection[];
  actualRunwayMonths: number;
  actualRunwayDate: string;
}

interface MonthBurnBreakdown {
  month: string;
  fixed: number;
  installments: number;
  planned: number;
  free: number;
}

/** 월별 burn 시퀀스 → projection 결과 (누적 remaining + actualRunway 계산) */
function computeProjection(
  totalAvailable: number,
  burns: MonthBurnBreakdown[],
  billingMonth: string,
): RunwayProjectionResult {
  const projections: MonthProjection[] = [];
  let remaining = totalAvailable;

  for (const b of burns) {
    if (remaining <= 0) break;

    const locked = b.fixed + b.installments + b.planned;
    const netBurn = locked + b.free;
    remaining -= netBurn;

    projections.push({
      month: b.month,
      fixed: b.fixed,
      installments: b.installments,
      locked,
      free_budget: b.free,
      income: 0,
      net_burn: netBurn,
      remaining: Math.max(remaining, 0),
    });
  }

  let actualRunwayMonths = 0;
  let actualRunwayDate = billingMonth;

  if (projections.length > 0) {
    const last = projections.at(-1)!;
    if (remaining <= 0) {
      const startOfLastMonth = remaining + last.net_burn;
      const fraction = last.net_burn > 0 ? startOfLastMonth / last.net_burn : 0;
      actualRunwayMonths = Math.round((projections.length - 1 + fraction) * 10) / 10;
    } else {
      actualRunwayMonths = projections.length;
    }
    actualRunwayDate = last.month;
  }

  return { projections, actualRunwayMonths, actualRunwayDate };
}

/** 동적 burn — freePerMonthEstimate 기반 시뮬레이션 (target 없을 때) */
export function projectRunway(input: RunwayProjectionInput): RunwayProjectionResult {
  const {
    billingMonth,
    totalAvailable,
    fixedMonthly,
    installmentLockByMonth,
    plannedExpenses,
    freePerMonthEstimate,
    maxMonths = 120,
  } = input;

  const burns: MonthBurnBreakdown[] = [];
  for (let i = 0; i < maxMonths; i++) {
    const month = addBillingMonths(billingMonth, i);
    const installmentSum = installmentLockByMonth.get(month) ?? 0;
    const plannedSum = plannedExpenses
      .filter((p) => p.yearMonth === month)
      .reduce((s, p) => s + p.amount, 0);

    burns.push({
      month,
      fixed: fixedMonthly,
      installments: installmentSum,
      planned: plannedSum,
      free: freePerMonthEstimate,
    });
  }

  return computeProjection(totalAvailable, burns, billingMonth);
}

/** allocator 결과 기반 projection — target 있을 때 정합성 보장 */
export function projectFromAllocator(
  totalAvailable: number,
  monthlyBudgets: MonthlyBudget[],
  billingMonth: string,
): RunwayProjectionResult {
  const burns: MonthBurnBreakdown[] = monthlyBudgets.map((mb) => ({
    month: mb.yearMonth,
    fixed: mb.fixed,
    installments: mb.installments,
    planned: mb.planned,
    free: mb.free,
  }));
  return computeProjection(totalAvailable, burns, billingMonth);
}
