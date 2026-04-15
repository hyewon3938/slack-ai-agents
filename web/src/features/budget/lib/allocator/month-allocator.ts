import { addBillingMonths, getBillingRange, calcCycleDays } from '../billing/cycle';
import { calcAllocatedDays } from './proration';
import type { BillingCycle, MonthAllocatorInput, MonthAllocatorResult, MonthlyBudget } from '../types-v2';

/** 자산/런웨이/고정비/할부/예정 → 월별 자유 예산 배분 */
export function allocateMonthlyBudgets(input: MonthAllocatorInput): MonthAllocatorResult {
  const {
    totalAvailable, fixedMonthly, installments, plannedExpenses,
    currentBillingMonth, targetMonth, today,
  } = input;

  const empty: MonthAllocatorResult = {
    monthlyBudgets: [], dailyFree: 0, freePerMonth: null, totalLocked: 0,
  };

  if (!targetMonth || !/^\d{4}-\d{2}$/.test(targetMonth)) return empty;

  const [cy, cm] = currentBillingMonth.split('-').map(Number);
  const [ty, tm] = targetMonth.split('-').map(Number);
  const monthCount = (ty - cy) * 12 + (tm - cm) + 1;
  if (monthCount <= 0) return empty;

  // 현재 주기 (입력으로 제공된 currentBillingMonth 사용 — today에서 재유도하지 않음)
  const { from: cf, to: ct } = getBillingRange(currentBillingMonth);
  const currentCycle: BillingCycle = {
    yearMonth: currentBillingMonth,
    from: cf,
    to: ct,
    totalDays: calcCycleDays(cf, ct),
  };
  const { allocatedDays: currentAllocatedDays } = calcAllocatedDays(today, currentCycle);

  const monthlyBudgets: MonthlyBudget[] = [];
  let totalLocked = 0;
  let sumDays = 0;

  for (let i = 0; i < monthCount; i++) {
    const month = addBillingMonths(currentBillingMonth, i);
    const { from, to } = getBillingRange(month);
    const cycleDays = calcCycleDays(from, to);
    const allocatedDays = i === 0 ? currentAllocatedDays : cycleDays;

    const installmentSum = installments
      .filter((inst) => inst.remainingCount > i && (i > 0 || !inst.isNew))
      .reduce((s, inst) => s + inst.monthlyAmount, 0);

    const plannedSum = plannedExpenses
      .filter((p) => p.yearMonth === month)
      .reduce((s, p) => s + p.amount, 0);

    const ratio = i === 0 ? allocatedDays / cycleDays : 1;
    const fixed = Math.round(fixedMonthly * ratio);
    const instVal = Math.round(installmentSum * ratio);
    const planned = Math.round(plannedSum * ratio);
    const monthLocked = fixed + instVal + planned;

    totalLocked += monthLocked;
    sumDays += allocatedDays;

    monthlyBudgets.push({
      yearMonth: month,
      allocatedDays,
      fixed,
      installments: instVal,
      planned,
      free: 0, // 아래에서 채움
      isCurrent: i === 0,
    });
  }

  const totalFree = Math.max(0, totalAvailable - totalLocked);
  const dailyFree = sumDays > 0 ? totalFree / sumDays : 0;
  const freePerMonth = Math.round(dailyFree * currentCycle.totalDays);

  for (const mb of monthlyBudgets) {
    mb.free = Math.round(dailyFree * mb.allocatedDays);
  }

  return { monthlyBudgets, dailyFree, freePerMonth, totalLocked };
}
