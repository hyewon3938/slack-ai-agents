import type { DayAllocatorInput, DayAllocatorResult } from '../types-v2';

/** 월 자유 예산 + 현재 지출 → 오늘 예산/남음 */
export function allocateTodayBudget(input: DayAllocatorInput): DayAllocatorResult {
  const { monthBudget, flexibleSpent, todayFlexSpent, cycleRemainingDays } = input;

  const monthBudgetRemaining = monthBudget - flexibleSpent;
  // 오늘 지출을 복원해 "오늘 시작 시점" 가용 예산 산정
  const budgetBeforeToday = monthBudgetRemaining + todayFlexSpent;
  const todayIncludedDays = Math.max(1, cycleRemainingDays + 1);

  // 이미 월 초과 상태면 오늘 예산 0으로 클램프 (누적 빚과 오늘 초과 분리)
  const todayBudget = budgetBeforeToday > 0
    ? Math.round(budgetBeforeToday / todayIncludedDays)
    : 0;

  const todayRemaining = todayBudget - todayFlexSpent;

  return { todayBudget, todayRemaining, monthBudgetRemaining };
}
