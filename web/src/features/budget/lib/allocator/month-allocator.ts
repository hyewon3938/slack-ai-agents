import { addBillingMonths, getBillingRange, calcCycleDays } from '../billing/cycle';
import type {
  BillingCycle,
  InstallmentInput,
  MonthAllocatorInput,
  MonthAllocatorResult,
  MonthlyBudget,
  PlannedInput,
} from '../types-v2';

interface MonthEntryInput {
  index: number;
  currentBillingMonth: string;
  currentAllocatedDays: number;
  fixedMonthly: number;
  installments: InstallmentInput[];
  plannedExpenses: PlannedInput[];
}

function buildMonthEntry(p: MonthEntryInput): { entry: MonthlyBudget; locked: number } {
  const month = addBillingMonths(p.currentBillingMonth, p.index);
  const { from, to } = getBillingRange(month);
  const cycleDays = calcCycleDays(from, to);
  const allocatedDays = p.index === 0 ? p.currentAllocatedDays : cycleDays;

  // 미래 결제주기 할부(p.index >= 1)는 INSERT 즉시 자산에서 차감되므로 monthBudget 락에서 제외.
  // 현재 월의 신규 할부(isNew=true)는 자유지출로 잡혀있어 락에서 제외 — 이중 카운트 방지.
  const installmentSum =
    p.index === 0
      ? p.installments
          .filter((inst) => inst.remainingCount > 0 && !inst.isNew)
          .reduce((s, inst) => s + inst.monthlyAmount, 0)
      : 0;
  const plannedSum = p.plannedExpenses
    .filter((e) => e.yearMonth === month)
    .reduce((s, e) => s + e.amount, 0);

  const ratio = p.index === 0 ? allocatedDays / cycleDays : 1;
  const fixed = Math.round(p.fixedMonthly * ratio);
  const instVal = Math.round(installmentSum * ratio);
  const planned = Math.round(plannedSum * ratio);

  return {
    entry: {
      yearMonth: month,
      allocatedDays,
      fixed,
      installments: instVal,
      planned,
      free: 0,
      isCurrent: p.index === 0,
    },
    locked: fixed + instVal + planned,
  };
}

/** 자산/런웨이/고정비/할부/예정 → 월별 자유 예산 배분 */
export function allocateMonthlyBudgets(input: MonthAllocatorInput): MonthAllocatorResult {
  const empty: MonthAllocatorResult = {
    monthlyBudgets: [],
    dailyFree: 0,
    freePerMonth: null,
    totalLocked: 0,
  };
  if (!input.targetMonth || !/^\d{4}-\d{2}$/.test(input.targetMonth)) return empty;

  const [cy, cm] = input.currentBillingMonth.split('-').map(Number);
  const [ty, tm] = input.targetMonth.split('-').map(Number);
  const monthCount = (ty - cy) * 12 + (tm - cm) + 1;
  if (monthCount <= 0) return empty;

  const { from: cf, to: ct } = getBillingRange(input.currentBillingMonth);
  const currentCycle: BillingCycle = {
    yearMonth: input.currentBillingMonth,
    from: cf,
    to: ct,
    totalDays: calcCycleDays(cf, ct),
  };
  const currentAllocatedDays = currentCycle.totalDays;

  const monthlyBudgets: MonthlyBudget[] = [];
  let totalLocked = 0;
  let sumDays = 0;
  for (let i = 0; i < monthCount; i++) {
    const { entry, locked } = buildMonthEntry({
      index: i,
      currentBillingMonth: input.currentBillingMonth,
      currentAllocatedDays,
      fixedMonthly: input.fixedMonthly,
      installments: input.installments,
      plannedExpenses: input.plannedExpenses,
    });
    monthlyBudgets.push(entry);
    totalLocked += locked;
    sumDays += entry.allocatedDays;
  }

  const bonus = Math.max(0, input.currentMonthOnlyIncome ?? 0);
  const totalFree = Math.max(0, input.totalAvailable - totalLocked - bonus);
  const dailyFree = sumDays > 0 ? totalFree / sumDays : 0;
  const freePerMonth = Math.round(dailyFree * currentCycle.totalDays);
  for (const mb of monthlyBudgets) mb.free = Math.round(dailyFree * mb.allocatedDays);
  if (bonus > 0) {
    const current = monthlyBudgets.find((mb) => mb.isCurrent);
    if (current) current.free += bonus;
  }

  return { monthlyBudgets, dailyFree, freePerMonth, totalLocked };
}
