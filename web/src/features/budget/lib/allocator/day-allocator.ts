import type { DayAllocatorInput, DayAllocatorResult } from '../types-v2';

/**
 * 일 예산 산정 — 두 값 동시 산출:
 * - todayBudget(기준): 수입 미반영 base / cycleTotalDays. 사이클 동안 사실상 불변.
 * - todayRecommended(오늘): 오늘 시작 시점 잔여 / 남은 일자. 마이너스면 0 클램프.
 *
 * 마이너스 상태에서 새 수입이 들어와도 기준은 흔들리지 않고, 오늘 예산만 회복.
 */
export function allocateTodayBudget(input: DayAllocatorInput): DayAllocatorResult {
  const {
    monthBudget,
    flexibleSpent,
    todayFlexSpent,
    cycleTotalDays,
    daysFromToday,
    currentMonthIncome,
  } = input;

  const baseBudget = monthBudget - currentMonthIncome;
  const todayBudget = cycleTotalDays > 0 ? Math.round(baseBudget / cycleTotalDays) : 0;

  const monthBudgetRemaining = monthBudget - flexibleSpent;

  // 오늘 시작 시점 잔여 = monthBudget − (어제까지 누적 자유 지출)
  //                  = monthBudgetRemaining + todayFlexSpent
  const remainingAtTodayStart = monthBudgetRemaining + todayFlexSpent;
  const todayRecommended =
    daysFromToday > 0 ? Math.max(0, Math.round(remainingAtTodayStart / daysFromToday)) : 0;

  const todayRemaining = todayRecommended - todayFlexSpent;

  return { todayBudget, todayRecommended, todayRemaining, monthBudgetRemaining };
}
