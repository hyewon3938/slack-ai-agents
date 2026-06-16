import { getBillingCycle, getBillingRange, calcCycleDays, addBillingMonths } from './billing/cycle';
import { calcAllocatedDays } from './allocator/proration';
import { allocateMonthlyBudgets } from './allocator/month-allocator';
import { allocateTodayBudget } from './allocator/day-allocator';
import { projectRunway, projectFromAllocator } from './allocator/runway-projection';
import { detectSettlementTrigger, buildSettlementSnapshot } from './settlement/settle';

import {
  readDistributableAssetBalance,
  applyAssetDeduction,
  applyAssetIncrease,
} from './repository/assets-repo';
import { readFixedCostsMonthlyTotal } from './repository/fixed-costs-repo';
import { readInstallmentLockByMonth } from './repository/installments-repo';
import { readPlannedExpenses } from './repository/planned-repo';
import { readIncomeTotal, readCurrentMonthOnlyIncome } from './repository/incomes-repo';
import {
  readFlexibleSpent,
  readExcludedSpent,
  readTodayFlexSpent,
  readTotalCycleSpent,
  readAvgVariableMonthly,
} from './repository/expenses-repo';
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
  const [totalAvailable, fixedMonthly, targetMonth, currentMonthOnlyIncome] = await Promise.all([
    computeTotalAvailable(userId, todayStr),
    readFixedCostsMonthlyTotal(userId),
    readTargetMonth(userId),
    readCurrentMonthOnlyIncome(userId, cycle.yearMonth, todayStr),
  ]);
  // 묶인 돈 창 = [현재 결제월, target_date]. target 없으면 현재월만.
  const windowEnd = targetMonth ?? cycle.yearMonth;
  const [planned, installmentLockByMonth] = await Promise.all([
    readPlannedExpenses(userId, cycle.yearMonth, windowEnd),
    readInstallmentLockByMonth(userId, cycle.yearMonth, windowEnd),
  ]);
  return allocateMonthlyBudgets({
    totalAvailable,
    fixedMonthly,
    installmentLockByMonth,
    plannedExpenses: planned,
    currentBillingMonth: cycle.yearMonth,
    targetMonth,
    today: todayStr,
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
    return {
      todayBudget: 0,
      todayRecommended: 0,
      todayRemaining: 0,
      monthBudgetRemaining: 0,
      todayFlexSpent: 0,
      targetDate: null,
    };
  }
  const todayStr = formatKSTDate(now);
  const [flex, todayFlex, targetDate, currentMonthIncome] = await Promise.all([
    readFlexibleSpent(userId, cycle.yearMonth, todayStr),
    readTodayFlexSpent(userId, todayStr, cycle.yearMonth),
    readTargetMonth(userId),
    readCurrentMonthOnlyIncome(userId, cycle.yearMonth, todayStr),
  ]);

  // 오늘 포함 사이클 끝까지 남은 일자. 사이클 종료 후엔 1로 클램프 (0 division 방어).
  const daysFromToday = Math.max(1, calcCycleDays(todayStr, cycle.to));

  return {
    ...allocateTodayBudget({
      monthBudget: currentMonth.free,
      flexibleSpent: flex,
      todayFlexSpent: todayFlex,
      cycleTotalDays: cycle.totalDays,
      daysFromToday,
      currentMonthIncome,
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

  const [monthly, avgVariableMonthly, fixedMonthly, targetDate] = await Promise.all([
    getMonthlyAllocation(userId, now),
    readAvgVariableMonthly(userId, 3),
    readFixedCostsMonthlyTotal(userId),
    readTargetMonth(userId),
  ]);

  const totalAvailable = await computeTotalAvailable(userId, todayStr);
  const freePerMonth = monthly.freePerMonth;

  let projResult;
  if (targetDate && monthly.monthlyBudgets.length > 0) {
    // target 있음 → allocator 결과 재사용 (정합성 보장)
    projResult = projectFromAllocator(totalAvailable, monthly.monthlyBudgets, cycle.yearMonth);
  } else {
    // target 없음 → 평균 지출 기반 시뮬레이션. 할부 burn은 billing_month별 락 맵으로 조회
    // (창 상한 없음 — 시뮬레이션 maxMonths(120)를 넉넉히 덮음).
    const projectionWindowEnd = addBillingMonths(cycle.yearMonth, 120);
    const [planned, installmentLockByMonth] = await Promise.all([
      readPlannedExpenses(userId, cycle.yearMonth, cycle.yearMonth),
      readInstallmentLockByMonth(userId, cycle.yearMonth, projectionWindowEnd),
    ]);
    projResult = projectRunway({
      billingMonth: cycle.yearMonth,
      totalAvailable,
      fixedMonthly,
      installmentLockByMonth,
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

  const [totalAvailable, fixedMonthly, currentMonthOnlyIncome] = await Promise.all([
    computeTotalAvailable(userId, todayStr),
    readFixedCostsMonthlyTotal(userId),
    readCurrentMonthOnlyIncome(userId, cycle.yearMonth, todayStr),
  ]);
  // 프리뷰 창 = [현재 결제월, 프리뷰 target]
  const [planned, installmentLockByMonth] = await Promise.all([
    readPlannedExpenses(userId, cycle.yearMonth, targetDate),
    readInstallmentLockByMonth(userId, cycle.yearMonth, targetDate),
  ]);

  const result = allocateMonthlyBudgets({
    totalAvailable,
    fixedMonthly,
    installmentLockByMonth,
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

  const [flex, excluded, income, totalSpent] = await Promise.all([
    readFlexibleSpent(userId, targetMonth, range.to),
    readExcludedSpent(userId, targetMonth),
    readIncomeTotal(userId, targetMonth),
    readTotalCycleSpent(userId, targetMonth),
  ]);

  // 정산 대상 월 기준 allocator 재실행 — T12:00:00Z = KST 21:00 (15일 이내)
  const targetEnd = new Date(`${range.to}T12:00:00Z`);
  const alloc = await getMonthlyAllocation(userId, targetEnd);
  const monthlyBudget = alloc.monthlyBudgets.find((m) => m.yearMonth === targetMonth);
  if (!monthlyBudget) {
    return { settled: false };
  }

  const prevSnapshot = await readLatestSnapshot(userId);
  const availableAtStart =
    prevSnapshot?.available_at_end ?? (await readDistributableAssetBalance(userId));
  // depletion 일원화 (#539, ADR 0051): 그 주기 전체 결제분을 자금에서 차감.
  // 장부(available_at_end → 다음 주기 시작값)도 전체 결제분 기준이라야 실제 자금과 어긋나지 않음.
  // flex/excluded는 snapshot 분해 표시용으로만 별도 기록.
  const availableAtEnd = availableAtStart + income - totalSpent;

  const snapshot = buildSettlementSnapshot({
    yearMonth: targetMonth,
    monthlyBudget,
    actualFlexibleSpent: flex,
    actualExcludedSpent: excluded,
    actualIncome: income,
    availableAtStart,
    availableAtEnd,
  });
  const result = await saveSnapshotIfAbsent(userId, snapshot);

  // snapshot 신규 저장 시에만 자산 변동 (UNIQUE(user, year_month)로 재실행 시 중복 차감 방지).
  // 등록 시점 차감을 폐지했으므로 할부 회차는 결제(이 주기)될 때 비로소 자금에서 빠진다.
  if (result.saved) {
    await applyAssetDeduction(userId, totalSpent);
    await applyAssetIncrease(userId, income);
  }

  return { settled: result.saved, snapshot };
}
