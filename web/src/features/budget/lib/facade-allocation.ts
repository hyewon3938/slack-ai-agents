import { getBillingCycle } from './billing/cycle';
import { allocateMonthlyBudgets } from './allocator/month-allocator';

import { readDistributableAssetBalance, readFundsAsOf } from './repository/assets-repo';
import { readFixedCostsMonthlyTotal } from './repository/fixed-costs-repo';
import { readInstallmentLockByMonth } from './repository/installments-repo';
import { readPlannedExpenses } from './repository/planned-repo';
import { readCurrentMonthOnlyIncome } from './repository/incomes-repo';
import { readReflectedBudgetOutflow } from './repository/expenses-repo';
import { readTargetMonth } from './repository/settings-repo';

import type { MonthAllocatorResult } from './types-v2';

// 월 배분과 그 기준선 계산. facade.ts와 facade-settlement.ts가 함께 쓰므로 따로 둔다.

export function formatKSTDate(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  return kst.toISOString().slice(0, 10);
}

/** 예산 기준선과 그 산출 근거 — 화면에 관계를 그대로 보여주기 위해 분해해서 반환 */
export interface FundsBaseline {
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
export async function computeFundsBaseline(userId: number, billingMonth: string): Promise<FundsBaseline> {
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
