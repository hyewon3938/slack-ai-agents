import { addBillingMonths } from '../billing/cycle';

export interface ProjectionInstallmentInput {
  monthlyAmount: number;
  remainingCount: number;
}

export interface ProjectionPlannedInput {
  yearMonth: string;
  amount: number;
}

export interface RunwayProjectionInput {
  billingMonth: string;
  totalAvailable: number;
  fixedMonthly: number;
  installments: ProjectionInstallmentInput[];
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

/** 월별 자산 소진 시뮬레이션 (순수 함수) */
export function projectRunway(input: RunwayProjectionInput): RunwayProjectionResult {
  const {
    billingMonth,
    totalAvailable,
    fixedMonthly,
    installments,
    plannedExpenses,
    freePerMonthEstimate,
    maxMonths = 120,
  } = input;

  const projections: MonthProjection[] = [];
  let remaining = totalAvailable;

  for (let i = 0; i < maxMonths && remaining > 0; i++) {
    const month = addBillingMonths(billingMonth, i);
    const installmentSum = installments
      .filter((inst) => inst.remainingCount > i)
      .reduce((s, inst) => s + inst.monthlyAmount, 0);
    const plannedSum = plannedExpenses
      .filter((p) => p.yearMonth === month)
      .reduce((s, p) => s + p.amount, 0);

    const locked = fixedMonthly + installmentSum + plannedSum;
    const netBurn = locked + freePerMonthEstimate;
    remaining -= netBurn;

    projections.push({
      month,
      fixed: fixedMonthly,
      installments: installmentSum,
      locked,
      free_budget: freePerMonthEstimate,
      income: 0,
      net_burn: netBurn,
      remaining: Math.max(remaining, 0),
    });

    if (remaining <= 0) break;
  }

  let actualRunwayMonths = 0;
  let actualRunwayDate = billingMonth;

  if (projections.length > 0) {
    const last = projections.at(-1)!;
    if (remaining <= 0) {
      // remaining은 클램핑 전 음수값. 마지막 달 시작 잔고 = remaining + last.net_burn
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
