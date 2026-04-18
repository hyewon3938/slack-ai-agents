import type { DayAllocatorInput, DayAllocatorResult } from '../types-v2';

/** 월 자유 예산 → 고정 하루 예산 (대금기간 동안 불변) */
export function allocateTodayBudget(input: DayAllocatorInput): DayAllocatorResult {
  const { monthBudget, flexibleSpent, todayFlexSpent, cycleTotalDays } = input;

  const monthBudgetRemaining = monthBudget - flexibleSpent;
  const todayBudget = cycleTotalDays > 0
    ? Math.round(monthBudget / cycleTotalDays)
    : 0;
  const todayRemaining = todayBudget - todayFlexSpent;

  return { todayBudget, todayRemaining, monthBudgetRemaining };
}
