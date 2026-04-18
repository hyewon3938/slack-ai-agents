import { getBillingCycle, getBillingRange } from './billing/cycle';
import { calcAllocatedDays } from './allocator/proration';
import { allocateMonthlyBudgets } from './allocator/month-allocator';
import { allocateTodayBudget } from './allocator/day-allocator';
import { projectRunway, projectFromAllocator } from './allocator/runway-projection';
import { detectSettlementTrigger, buildSettlementSnapshot } from './settlement/settle';

import { readDistributableAssetBalance } from './repository/assets-repo';
import { readFixedCostsMonthlyTotal } from './repository/fixed-costs-repo';
import { readActiveInstallments } from './repository/installments-repo';
import { readPlannedExpenses } from './repository/planned-repo';
import { readIncomeTotal, readCurrentMonthOnlyIncome } from './repository/incomes-repo';
import { readFlexibleSpent, readExcludedSpent, readTodayFlexSpent, readAvgVariableMonthly } from './repository/expenses-repo';
import { readTargetMonth } from './repository/settings-repo';
import { readLatestSnapshot, saveSnapshotIfAbsent } from './snapshot/monthly-snapshot-repo';

import type { MonthAllocatorResult, DayAllocatorResult, SettlementSnapshot } from './types-v2';
import type { MonthProjection } from './allocator/runway-projection';

export type { MonthProjection };

export interface TodayAllocationResult extends DayAllocatorResult {
  todayFlexSpent: number;
  targetDate: string | null;
}

export interface RunwayProjectionResponse {
  actual_runway_months: number;
  actual_runway_date: string;
  free_per_month: number | null;
  effective_available: number;
  fixed_monthly: number;
  avg_variable_monthly: number;
  target_date: string | null;
  projections: MonthProjection[];
}

export interface BudgetPreviewResponse {
  free_per_month: number | null;
  daily_estimate: number;
  month_breakdown: Array<{
    month: string;
    locked: number;
    installments: number;
    planned: number;
    free: number;
    daily: number;
  }>;
}

function formatKSTDate(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  return kst.toISOString().slice(0, 10);
}

/** 가용자금 = 현재 자산 잔액 (사용자가 갱신하는 실제 재정 상태) */
async function computeTotalAvailable(userId: number, _today: string): Promise<number> {
  return readDistributableAssetBalance(userId);
}

/** 월 예산 배분 */
export async function getMonthlyAllocation(
  userId: number,
  now: Date,
): Promise<MonthAllocatorResult> {
  const cycle = getBillingCycle(now);
  const todayStr = formatKSTDate(now);
  const [totalAvailable, fixedMonthly, installments, targetMonth, currentMonthOnlyIncome] = await Promise.all([
    computeTotalAvailable(userId, todayStr),
    readFixedCostsMonthlyTotal(userId),
    readActiveInstallments(userId, cycle.from),
    readTargetMonth(userId),
    readCurrentMonthOnlyIncome(userId, cycle.from, todayStr),
  ]);
  const planned = await readPlannedExpenses(
    userId, cycle.yearMonth, targetMonth ?? cycle.yearMonth,
  );
  return allocateMonthlyBudgets({
    totalAvailable, fixedMonthly, installments,
    plannedExpenses: planned,
    currentBillingMonth: cycle.yearMonth,
    targetMonth, today: todayStr,
    currentMonthOnlyIncome,
  });
}

/** 일 예산 배분 */
export async function getTodayAllocation(
  userId: number,
  now: Date,
): Promise<TodayAllocationResult> {
  const cycle = getBillingCycle(now);
  const monthly = await getMonthlyAllocation(userId, now);
  const currentMonth = monthly.monthlyBudgets.find((m) => m.isCurrent);
  if (!currentMonth) {
    return { todayBudget: 0, todayRemaining: 0, monthBudgetRemaining: 0, todayFlexSpent: 0, targetDate: null };
  }
  const todayStr = formatKSTDate(now);
  const [flex, todayFlex, targetDate] = await Promise.all([
    readFlexibleSpent(userId, cycle.from, todayStr),
    readTodayFlexSpent(userId, todayStr),
    readTargetMonth(userId),
  ]);
  return {
    ...allocateTodayBudget({
      monthBudget: currentMonth.free,
      flexibleSpent: flex,
      todayFlexSpent: todayFlex,
      cycleTotalDays: cycle.totalDays,
    }),
    todayFlexSpent: todayFlex,
    targetDate,
  };
}

/** 런웨이 projection + 참고 수치 */
export async function getRunwayProjection(
  userId: number,
  now: Date,
): Promise<RunwayProjectionResponse> {
  const cycle = getBillingCycle(now);
  const todayStr = formatKSTDate(now);

  const [monthly, avgVariableMonthly, fixedMonthly, installments, targetDate] = await Promise.all([
    getMonthlyAllocation(userId, now),
    readAvgVariableMonthly(userId, 3),
    readFixedCostsMonthlyTotal(userId),
    readActiveInstallments(userId, cycle.from),
    readTargetMonth(userId),
  ]);

  const totalAvailable = await computeTotalAvailable(userId, todayStr);
  const freePerMonth = monthly.freePerMonth;

  let projResult;
  if (targetDate && monthly.monthlyBudgets.length > 0) {
    // target 있음 → allocator 결과 재사용 (정합성 보장)
    projResult = projectFromAllocator(totalAvailable, monthly.monthlyBudgets, cycle.yearMonth);
  } else {
    // target 없음 → 평균 지출 기반 시뮬레이션
    const planned = await readPlannedExpenses(userId, cycle.yearMonth, cycle.yearMonth);
    projResult = projectRunway({
      billingMonth: cycle.yearMonth,
      totalAvailable,
      fixedMonthly,
      installments: installments.map((inst) => ({
        monthlyAmount: inst.monthlyAmount,
        remainingCount: inst.remainingCount,
      })),
      plannedExpenses: planned,
      freePerMonthEstimate: avgVariableMonthly,
    });
  }

  return {
    actual_runway_months: projResult.actualRunwayMonths,
    actual_runway_date: projResult.actualRunwayDate,
    free_per_month: freePerMonth,
    effective_available: totalAvailable,
    fixed_monthly: fixedMonthly,
    avg_variable_monthly: avgVariableMonthly,
    target_date: targetDate,
    projections: projResult.projections,
  };
}

/** 목표 날짜 변경 프리뷰 — 저장 없이 allocator를 override해 결과만 반환 */
export async function getBudgetPreview(
  userId: number,
  now: Date,
  targetDate: string,
): Promise<BudgetPreviewResponse | null> {
  if (!/^\d{4}-\d{2}$/.test(targetDate)) return null;

  const cycle = getBillingCycle(now);
  const todayStr = formatKSTDate(now);

  const [totalAvailable, fixedMonthly, installments, currentMonthOnlyIncome] = await Promise.all([
    computeTotalAvailable(userId, todayStr),
    readFixedCostsMonthlyTotal(userId),
    readActiveInstallments(userId, cycle.from),
    readCurrentMonthOnlyIncome(userId, cycle.from, todayStr),
  ]);
  const planned = await readPlannedExpenses(userId, cycle.yearMonth, targetDate);

  const result = allocateMonthlyBudgets({
    totalAvailable,
    fixedMonthly,
    installments,
    plannedExpenses: planned,
    currentBillingMonth: cycle.yearMonth,
    targetMonth: targetDate,
    today: todayStr,
    currentMonthOnlyIncome,
  });

  if (result.freePerMonth === null) return null;

  return {
    free_per_month: result.freePerMonth,
    daily_estimate: Math.round(result.dailyFree),
    month_breakdown: result.monthlyBudgets.map((m) => ({
      month: m.yearMonth,
      locked: m.fixed + m.installments + m.planned,
      installments: m.installments,
      planned: m.planned,
      free: m.free,
      daily: m.allocatedDays > 0 ? Math.round(m.free / m.allocatedDays) : 0,
    })),
  };
}

/** 월 경계 정산 (Phase 4 cron 진입점) */
export async function runSettlementIfDue(
  userId: number,
  now: Date,
): Promise<{ settled: boolean; snapshot?: SettlementSnapshot }> {
  const trigger = detectSettlementTrigger(now);
  if (!trigger.shouldSettle || !trigger.targetMonth) {
    return { settled: false };
  }
  const targetMonth = trigger.targetMonth;
  const range = getBillingRange(targetMonth);

  const [flex, excluded, income] = await Promise.all([
    readFlexibleSpent(userId, range.from, range.to),
    readExcludedSpent(userId, range.from, range.to),
    readIncomeTotal(userId, range.from, range.to),
  ]);

  // 정산 대상 월 기준 allocator 재실행 — T12:00:00Z = KST 21:00 (15일 이내)
  const targetEnd = new Date(`${range.to}T12:00:00Z`);
  const alloc = await getMonthlyAllocation(userId, targetEnd);
  const monthlyBudget = alloc.monthlyBudgets.find((m) => m.yearMonth === targetMonth);
  if (!monthlyBudget) {
    return { settled: false };
  }

  const prevSnapshot = await readLatestSnapshot(userId);
  const availableAtStart = prevSnapshot?.available_at_end ?? await readDistributableAssetBalance(userId);
  const availableAtEnd = availableAtStart + income - flex - excluded;

  const snapshot = buildSettlementSnapshot({
    yearMonth: targetMonth, monthlyBudget,
    actualFlexibleSpent: flex, actualExcludedSpent: excluded, actualIncome: income,
    availableAtStart, availableAtEnd,
  });
  const result = await saveSnapshotIfAbsent(userId, snapshot);
  return { settled: result.saved, snapshot };
}
