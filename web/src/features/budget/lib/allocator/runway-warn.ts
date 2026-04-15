export interface RunwayShortenInput {
  todayRemaining: number | null;
  todayBudget: number | null;
  totalBudget: number | null;
  totalDays: number;
  daysLeft: number;
}

/**
 * 오늘 초과분이 남은 기간 내내 누적될 경우 런웨이가 며칠 단축되는지 계산 (순수).
 * null 반환 시 경고 미표시.
 */
export function calcRunwayShorten(input: RunwayShortenInput): number | null {
  const { todayRemaining, todayBudget, totalBudget, totalDays, daysLeft } = input;
  if (todayRemaining == null || todayRemaining >= 0 || daysLeft <= 0) return null;

  const baseDaily =
    todayBudget != null && todayBudget > 0
      ? todayBudget
      : totalBudget != null && totalBudget > 0 && totalDays > 0
        ? Math.round(totalBudget / totalDays)
        : 0;

  if (baseDaily <= 0) return null;
  return Math.floor((Math.abs(todayRemaining) * daysLeft) / baseDaily);
}
