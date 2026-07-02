import {
  getBillingCycle,
  getBillingRange,
  getCurrentBillingMonth,
  calcCycleDays,
  addBillingMonths,
} from './billing/cycle';
import { calcAllocatedDays } from './allocator/proration';
import { allocateMonthlyBudgets } from './allocator/month-allocator';
import { allocateTodayBudget } from './allocator/day-allocator';
import { projectRunway, projectFromAllocator } from './allocator/runway-projection';
import { buildSettlementSnapshot } from './settlement/settle';
import { ensureFixedCostExpenses } from './fixed-cost-ensure';

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
  // 하위호환: actual_* / projections 는 (target ? 계획 : 페이스) — 기존 의미 불변.
  actual_runway_months: number;
  actual_runway_date: string;
  free_per_month: number | null;
  effective_available: number;
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

  const totalAvailable = await computeTotalAvailable(userId, todayStr);
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

/** catch-up 정산 상한 — 크론 장기 미실행 시에도 한 번에 최대 이 개수까지만 소급 (폭주 방지) */
const MAX_CATCHUP_MONTHS = 3;

/**
 * 정산이 필요한(=아직 스냅샷이 없는) 종료된 결제주기 목록을 오래된 순으로 반환.
 *
 * - `current`(진행 중 주기)는 아직 안 끝났으므로 제외.
 * - 최신 스냅샷이 있으면 그 다음 달부터 `current` 직전까지를 후보로 삼되, 오래된 순 최대 3개월만 (cap).
 * - 스냅샷이 하나도 없으면 직전 종료 주기 1개만 (초회 대량 소급 방지 — 기존 동작 보존).
 */
export async function listUnsettledMonths(userId: number, now: Date): Promise<string[]> {
  const current = getCurrentBillingMonth(now);
  const lastEnded = addBillingMonths(current, -1); // current 직전 = 마지막으로 끝난 주기

  const latest = (await readLatestSnapshot(userId))?.year_month;

  // 스냅샷 전무 → 직전 1개만
  if (!latest) return [lastEnded];

  // 이미 최신까지(또는 그 이상) 정산됨 → 없음
  if (latest >= lastEnded) return [];

  // (latest, lastEnded] 구간을 오래된 순으로 수집
  const months: string[] = [];
  let cursor = addBillingMonths(latest, 1);
  while (cursor <= lastEnded) {
    months.push(cursor);
    cursor = addBillingMonths(cursor, 1);
  }

  // cap: 오래된 순 최대 MAX_CATCHUP_MONTHS 개 — 매일 실행되는 크론이 순서대로 따라잡는 자기치유 cap.
  // (최신 우선으로 자르면 정산 후 latest가 잘린 옛 주기를 건너뛰어 영구 탈락 — 히스토리에 구멍)
  return months.slice(0, MAX_CATCHUP_MONTHS);
}

/** 단일 결제주기 정산 — 고정비 보장 후 스냅샷 저장 + (신규 시) 자산 변동 */
async function settleMonth(
  userId: number,
  targetMonth: string,
): Promise<SettlementSnapshot | null> {
  // 정산 직전 고정비 자동 기록 보장 — 대시보드 조회 부수효과에 의존하지 않고 여기서 확정.
  // (과거 월도 ensureFixedCostExpenses 의 expenseDate<=today 필터로 전부 생성됨)
  await ensureFixedCostExpenses(userId, targetMonth);

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
    console.warn(`[settlement] user ${userId} ${targetMonth}: allocator에 대상 월 없음 → skip`);
    return null;
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

  // 금액 로그 금지 — 월·신규저장 여부(불리언)만 기록.
  console.info(`[settlement] user ${userId} ${targetMonth}: saved=${result.saved}`);

  return result.saved ? snapshot : null;
}

/**
 * 월 경계 정산 (Phase 4 cron 진입점).
 *
 * 매일 실행되며, 아직 정산 안 된 종료 주기가 있으면 오래된 순으로 순차 정산한다(catch-up).
 * 크론이 특정 날짜에 실패해도 다음 실행에서 자동 보정되며, `saveSnapshotIfAbsent` 멱등성으로
 * 재실행 시 자산 이중 변동은 발생하지 않는다.
 */
export async function runSettlementIfDue(
  userId: number,
  now: Date,
): Promise<{ settled: boolean; snapshots: SettlementSnapshot[] }> {
  const targetMonths = await listUnsettledMonths(userId, now);
  if (targetMonths.length === 0) {
    return { settled: false, snapshots: [] };
  }

  const catchUp = targetMonths.length > 1;
  console.info(`[settlement] user ${userId}: 대상 ${targetMonths.length}개월 catch-up=${catchUp}`);

  const snapshots: SettlementSnapshot[] = [];
  // 오래된 순 순차 처리 — available_at_start 체인이 직전 스냅샷의 available_at_end 를 참조하므로 순서 중요.
  for (const targetMonth of targetMonths) {
    const snapshot = await settleMonth(userId, targetMonth);
    if (snapshot) snapshots.push(snapshot);
  }

  return { settled: snapshots.length > 0, snapshots };
}
