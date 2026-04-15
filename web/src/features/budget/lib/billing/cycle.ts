import type { BillingCycle } from '../types-v2';

/** Date를 KST로 변환해 { year, month, day } 반환 */
function toKST(utc: Date): { year: number; month: number; day: number } {
  const kstMs = utc.getTime() + 9 * 3600 * 1000;
  const d = new Date(kstMs);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 현재 결제 주기의 billing month (16일 이후면 다음 달) */
export function getCurrentBillingMonth(now: Date): string {
  const { year, month, day } = toKST(now);
  if (day >= 16) {
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    return `${nextYear}-${pad2(nextMonth)}`;
  }
  return `${year}-${pad2(month)}`;
}

/** 결제 주기 날짜 범위 (전월 16일 ~ 당월 15일) */
export function getBillingRange(yearMonth: string): { from: string; to: string } {
  const [y, m] = yearMonth.split('-').map(Number);
  const prevMonth = m === 1 ? 12 : m - 1;
  const prevYear = m === 1 ? y - 1 : y;
  return {
    from: `${prevYear}-${pad2(prevMonth)}-16`,
    to: `${y}-${pad2(m)}-15`,
  };
}

/** 결제 주기 일수 (from ~ to 포함) */
export function calcCycleDays(from: string, to: string): number {
  const diff = new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime();
  return Math.round(diff / 86400000) + 1;
}

/** yearMonth에 offset 개월 더하기 */
export function addBillingMonths(yearMonth: string, offset: number): string {
  const [y, m] = yearMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + offset, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

/** 현재 날짜 기반 BillingCycle 객체 */
export function getBillingCycle(now: Date): BillingCycle {
  const yearMonth = getCurrentBillingMonth(now);
  const { from, to } = getBillingRange(yearMonth);
  return { yearMonth, from, to, totalDays: calcCycleDays(from, to) };
}

/** 날짜(YYYY-MM-DD)가 결제 주기 마지막 날(15일)인지 */
export function isLastDayOfCycle(date: string): boolean {
  return date.endsWith('-15');
}
