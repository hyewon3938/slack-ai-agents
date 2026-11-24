import { getBillingCycle, calcCycleDays, addBillingMonths } from './billing/cycle';
import { allocateMonthlyBudgets } from './allocator/month-allocator';
import { allocateTodayBudget } from './allocator/day-allocator';
import { projectRunway, projectFromAllocator } from './allocator/runway-projection';

import { readDistributableAssetBalance, readFundsAsOf } from './repository/assets-repo';
import { readFixedCostsMonthlyTotal } from './repository/fixed-costs-repo';
import { readInstallmentLockByMonth } from './repository/installments-repo';
import { readPlannedExpenses } from './repository/planned-repo';
import { readCurrentMonthOnlyIncome } from './repository/incomes-repo';
import {
  readFlexibleSpent,
  readTodayFlexSpent,
  readAvgVariableMonthly,
  readReflectedBudgetOutflow,
} from './repository/expenses-repo';
import { readTargetMonth } from './repository/settings-repo';

import type { MonthAllocatorResult, DayAllocatorResult } from './types-v2';
import type { MonthProjection } from './allocator/runway-projection';

export type { MonthProjection };

// 정산 계열은 facade-settlement.ts로 분리. 기존 import 경로 호환을 위해 여기서 재수출한다.
export { listUnsettledMonths, runSettlementIfDue } from './facade-settlement';

export interface TodayAllocationResult extends DayAllocatorResult {
  todayFlexSpent: number;
  targetDate: string | null;
}

export interface RunwayProjectionResponse {
  // 하위호환: actual_* / projections 는 (target ? 계획 : 페이스) — 기존 의미 불변.
  actual_runway_months: number;
  actual_runway_date: string;
  free_per_month: number | null;
  effective_available: number;
  /** 사용자가 입력한 잔액 — effective_available 의 산출 근거 (#615) */
  funds_balance: number;
  /** 입력 잔액에 되돌린 금액 — 기준일까지 이미 나갔지만 예산이 다시 빼는 몫 */
  funds_restored: number;
  /** 입력 잔액의 기준일. 미상이면 null */
  funds_as_of: string | null;
  fixed_monthly: number;
  avg_variable_monthly: number;
  target_date: string | null;
  projections: MonthProjection[];
  // 신규: 페이스 전망은 target 유무와 무관하게 항상 계산 (최근 실지출 기반).
  pace_runway_months: number;
  pace_runway_date: string;
  // 신규: 계획 전망은 target 있을 때만 (allocator 배분 기준). 없으면 null.
  plan_projections: MonthProjection[] | null;
  pace_projections: MonthProjection[];
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

/** 예산 기준선과 그 산출 근거 — 화면에 관계를 그대로 보여주기 위해 분해해서 반환 */
interface FundsBaseline {
  /** 예산 계산에 쓰는 기준선 = balance + restored */
  total: number;
  /** 사용자가 입력한 잔액 (비상금 제외 자산 합) */
  balance: number;
  /** 기준일까지 이미 나갔지만 예산이 다시 빼는 몫 */
  restored: number;
  /** 입력 잔액의 기준일. 미상이면 null */
  asOf: string | null;
}

/**
 * 가용자금 = 저장된 잔액 + 기준일까지 이미 나간 즉시 출금분 중 예산이 별도로 차감하는 몫.
 *
 * 사용자가 넣는 값은 "기준일 시점의 통장 잔액 그대로"다. 그 잔액엔 이번 주기 즉시 출금
 * 지출이 이미 빠져 있는데 예산은 그 지출을 자유지출·묶인 돈으로 다시 빼므로,
 * 예산 계산에 쓸 기준선은 주기 시작 시점으로 되돌려 놓아야 한다 (#615, ADR 0062).
 */
async function computeFundsBaseline(userId: number, billingMonth: string): Promise<FundsBaseline> {
  const [balance, asOf] = await Promise.all([
    readDistributableAssetBalance(userId),
    readFundsAsOf(userId),
  ]);
  // 기준일 미상 → 복원 0 (보수적)
  if (!asOf) return { total: balance, balance, restored: 0, asOf: null };

  const restored = await readReflectedBudgetOutflow(userId, billingMonth, asOf);
  return { total: balance + restored, balance, restored, asOf };
}

/** 월 예산 배분 */
export async function getMonthlyAllocation(
  userId: number,
  now: Date,
): Promise<MonthAllocatorResult> {
  const cycle = getBillingCycle(now);
  const todayStr = formatKSTDate(now);
  const [funds, fixedMonthly, targetMonth, currentMonthOnlyIncome] = await Promise.all([
    computeFundsBaseline(userId, cycle.yearMonth),
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
    totalAvailable: funds.total,
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

  // 페이스 전망용 창: [현재 결제월, +120] — 시뮬레이션 maxMonths(120)를 넉넉히 덮음.
  // target 유무와 무관하게 항상 조회 (페이스 전망은 target 너머까지 이어짐).
  const paceWindowEnd = addBillingMonths(cycle.yearMonth, 120);
  const [monthly, avgVariableMonthly, fixedMonthly, targetDate, pacePlanned, paceInstallmentLock] =
    await Promise.all([
      getMonthlyAllocation(userId, now),
      readAvgVariableMonthly(userId, 3, cycle.yearMonth),
      readFixedCostsMonthlyTotal(userId),
      readTargetMonth(userId),
      readPlannedExpenses(userId, cycle.yearMonth, paceWindowEnd),
      readInstallmentLockByMonth(userId, cycle.yearMonth, paceWindowEnd),
    ]);

  const funds = await computeFundsBaseline(userId, cycle.yearMonth);
  const totalAvailable = funds.total;
  const freePerMonth = monthly.freePerMonth;

  // 페이스 전망 (항상): 최근 실지출(avgVariableMonthly)을 자유 지출 추정치로 소진 시뮬레이션.
  const paceResult = projectRunway({
    billingMonth: cycle.yearMonth,
    totalAvailable,
    fixedMonthly,
    installmentLockByMonth: paceInstallmentLock,
    plannedExpenses: pacePlanned,
    freePerMonthEstimate: avgVariableMonthly,
  });

  // 계획 전망 (target 있을 때만): allocator 배분 결과 재사용 (정합성 보장 — target월에 잔액 0 수렴).
  const planResult =
    targetDate && monthly.monthlyBudgets.length > 0
      ? projectFromAllocator(totalAvailable, monthly.monthlyBudgets, cycle.yearMonth)
      : null;

  // 하위호환: actual_* / projections = target 있으면 계획, 없으면 페이스 (기존 의미 유지).
  const primary = planResult ?? paceResult;

  return {
    actual_runway_months: primary.actualRunwayMonths,
    actual_runway_date: primary.actualRunwayDate,
    free_per_month: freePerMonth,
    effective_available: totalAvailable,
    funds_balance: funds.balance,
    funds_restored: funds.restored,
    funds_as_of: funds.asOf,
    fixed_monthly: fixedMonthly,
    avg_variable_monthly: avgVariableMonthly,
    target_date: targetDate,
    projections: primary.projections,
    pace_runway_months: paceResult.actualRunwayMonths,
    pace_runway_date: paceResult.actualRunwayDate,
    plan_projections: planResult ? planResult.projections : null,
    pace_projections: paceResult.projections,
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

  const [funds, fixedMonthly, currentMonthOnlyIncome] = await Promise.all([
    computeFundsBaseline(userId, cycle.yearMonth),
    readFixedCostsMonthlyTotal(userId),
    readCurrentMonthOnlyIncome(userId, cycle.yearMonth, todayStr),
  ]);
  // 프리뷰 창 = [현재 결제월, 프리뷰 target]
  const [planned, installmentLockByMonth] = await Promise.all([
    readPlannedExpenses(userId, cycle.yearMonth, targetDate),
    readInstallmentLockByMonth(userId, cycle.yearMonth, targetDate),
  ]);

  const result = allocateMonthlyBudgets({
    totalAvailable: funds.total,
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
