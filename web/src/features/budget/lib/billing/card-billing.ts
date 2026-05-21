/** 카드별 대금기간 상수 (startDay: 해당 일 이상이면 다음 달 대금) */
export const CARD_BILLING_CYCLES: Record<string, { startDay: number }> = {
  현대카드: { startDay: 15 },
  국민카드: { startDay: 13 },
};

/** 시스템 기본 대금기간 시작일 (현대카드 기준) */
const DEFAULT_START_DAY = 15;

/**
 * 결제수단 + 결제일 → 귀속 billing month 반환
 *
 * - 현대카드: 15일 이상 → 다음 달 대금
 * - 국민카드: 13일 이상 → 다음 달 대금
 * - 현금 / 미등록 결제수단: 시스템 기본(15일 기준) 적용
 *
 * @param date 'YYYY-MM-DD'
 * @param paymentMethod 결제수단 문자열
 * @returns 'YYYY-MM'
 */
export function getBillingMonthForExpense(date: string, paymentMethod: string): string {
  const d = new Date(`${date}T00:00:00`);
  const day = d.getDate();
  const startDay = CARD_BILLING_CYCLES[paymentMethod]?.startDay ?? DEFAULT_START_DAY;

  if (day >= startDay) {
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * 할부 마지막 회차의 billing_month 계산 (할부 토글 조건부 노출 판단용).
 *
 * createInstallmentExpenses와 동일한 분할 로직: 첫 회차 date 기준 (months - 1)개월 후의 billing_month.
 *
 * @param firstDate 첫 회차 date 'YYYY-MM-DD'
 * @param months 총 할부 개월 수 (>= 1)
 * @param paymentMethod 결제수단 문자열
 * @returns 'YYYY-MM' 마지막 회차 billing_month
 */
export function computeLastInstallmentBillingMonth(
  firstDate: string,
  months: number,
  paymentMethod: string,
): string {
  const baseDate = new Date(`${firstDate}T00:00:00`);
  baseDate.setMonth(baseDate.getMonth() + (months - 1));
  const expDate = `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}-${String(baseDate.getDate()).padStart(2, '0')}`;
  return getBillingMonthForExpense(expDate, paymentMethod);
}
