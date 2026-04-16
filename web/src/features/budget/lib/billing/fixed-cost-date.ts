/**
 * 결제주기 기반 고정비 기록 날짜 결정 (순수 함수).
 * 결제주기는 전월 16일 ~ 당월 15일이므로, day_of_month >= 16 이면 전월에 기록된다.
 * 해당 월에 day_of_month 가 없는 경우(예: 2월 31일)는 그 달의 말일로 보정한다.
 *
 * @param yearMonth 'YYYY-MM' — 결제주기 기준 월
 * @param dayOfMonth 1~31 — 고정비 결제일
 * @returns 'YYYY-MM-DD'
 */
export function resolveFixedCostExpenseDate(
  yearMonth: string,
  dayOfMonth: number,
): string {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
    throw new Error(`invalid yearMonth: ${yearMonth}`);
  }
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
    throw new Error(`invalid dayOfMonth: ${dayOfMonth}`);
  }

  const [year, month] = yearMonth.split('-').map(Number);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;

  const expenseYear = dayOfMonth >= 16 ? prevYear : year;
  const expenseMonth = dayOfMonth >= 16 ? prevMonth : month;

  const lastDay = new Date(expenseYear, expenseMonth, 0).getDate();
  const actualDay = Math.min(dayOfMonth, lastDay);

  return `${expenseYear}-${String(expenseMonth).padStart(2, '0')}-${String(actualDay).padStart(2, '0')}`;
}
