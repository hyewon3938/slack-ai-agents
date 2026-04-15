import { getBillingCycle, getBillingRange } from './billing/cycle';
import { calcAllocatedDays } from './allocator/proration';
import { allocateMonthlyBudgets } from './allocator/month-allocator';
import { allocateTodayBudget } from './allocator/day-allocator';
import { detectSettlementTrigger, buildSettlementSnapshot } from './settlement/settle';

import { readTotalAssetBalance } from './repository/assets-repo';
import { readFixedCostsMonthlyTotal } from './repository/fixed-costs-repo';
import { readActiveInstallments } from './repository/installments-repo';
import { readPlannedExpenses } from './repository/planned-repo';
import { readIncomeTotal } from './repository/incomes-repo';
import { readFlexibleSpent, readExcludedSpent, readTodayFlexSpent } from './repository/expenses-repo';
import { readTargetMonth } from './repository/settings-repo';
import { readLatestSnapshot, saveSnapshotIfAbsent } from './snapshot/monthly-snapshot-repo';

import type { MonthAllocatorResult, DayAllocatorResult, SettlementSnapshot } from './types-v2';

function formatKSTDate(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  return kst.toISOString().slice(0, 10);
}

function addOneDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** 최신 스냅샷 기준 가용자금 계산 (없으면 전체 자산 합계 fallback) */
async function computeTotalAvailable(userId: number, today: string): Promise<number> {
  const snapshot = await readLatestSnapshot(userId);
  if (!snapshot) {
    return readTotalAssetBalance(userId);
  }
  const snapshotEnd = getBillingRange(snapshot.year_month).to;
  const fromDate = addOneDay(snapshotEnd);
  const [income, flex, excluded] = await Promise.all([
    readIncomeTotal(userId, fromDate, today),
    readFlexibleSpent(userId, fromDate, today),
    readExcludedSpent(userId, fromDate, today),
  ]);
  return snapshot.available_at_end + income - flex - excluded;
}

/** 월 예산 배분 */
export async function getMonthlyAllocation(
  userId: number,
  now: Date,
): Promise<MonthAllocatorResult> {
  const cycle = getBillingCycle(now);
  const todayStr = formatKSTDate(now);
  const [totalAvailable, fixedMonthly, installments, targetMonth] = await Promise.all([
    computeTotalAvailable(userId, todayStr),
    readFixedCostsMonthlyTotal(userId),
    readActiveInstallments(userId, cycle.from),
    readTargetMonth(userId),
  ]);
  const planned = await readPlannedExpenses(
    userId, cycle.yearMonth, targetMonth ?? cycle.yearMonth,
  );
  return allocateMonthlyBudgets({
    totalAvailable, fixedMonthly, installments,
    plannedExpenses: planned,
    currentBillingMonth: cycle.yearMonth,
    targetMonth, today: todayStr,
  });
}

/** 일 예산 배분 */
export async function getTodayAllocation(
  userId: number,
  now: Date,
): Promise<DayAllocatorResult> {
  const cycle = getBillingCycle(now);
  const monthly = await getMonthlyAllocation(userId, now);
  const currentMonth = monthly.monthlyBudgets.find((m) => m.isCurrent);
  if (!currentMonth) {
    return { todayBudget: 0, todayRemaining: 0, monthBudgetRemaining: 0 };
  }
  const todayStr = formatKSTDate(now);
  const { remaining } = calcAllocatedDays(todayStr, cycle);
  const [flex, todayFlex] = await Promise.all([
    readFlexibleSpent(userId, cycle.from, todayStr),
    readTodayFlexSpent(userId, todayStr),
  ]);
  return allocateTodayBudget({
    monthBudget: currentMonth.free,
    flexibleSpent: flex,
    todayFlexSpent: todayFlex,
    cycleRemainingDays: remaining,
  });
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
  const availableAtStart = prevSnapshot?.available_at_end ?? await readTotalAssetBalance(userId);
  const availableAtEnd = await computeTotalAvailable(userId, formatKSTDate(now));

  const snapshot = buildSettlementSnapshot({
    yearMonth: targetMonth, monthlyBudget,
    actualFlexibleSpent: flex, actualExcludedSpent: excluded, actualIncome: income,
    availableAtStart, availableAtEnd,
  });
  const result = await saveSnapshotIfAbsent(userId, snapshot);
  return { settled: result.saved, snapshot };
}
