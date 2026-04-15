import type { SettlementInput, SettlementSnapshot } from '../types-v2';

function toKSTDateStr(utc: Date): string {
  const kstMs = utc.getTime() + 9 * 3600 * 1000;
  const d = new Date(kstMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function subtractOneDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 어제 날짜가 주기 마지막 날(15일)인지 확인 */
export function detectSettlementTrigger(
  today: Date,
): { shouldSettle: boolean; targetMonth: string | null } {
  const todayKST = toKSTDateStr(today);
  const yesterday = subtractOneDay(todayKST);
  const day = parseInt(yesterday.slice(8, 10), 10);

  if (day !== 15) return { shouldSettle: false, targetMonth: null };

  const targetMonth = yesterday.slice(0, 7); // YYYY-MM
  return { shouldSettle: true, targetMonth };
}

/** 월 경계 시점에 스냅샷 구조 생성 (DB 저장은 호출자가 담당) */
export function buildSettlementSnapshot(input: SettlementInput): SettlementSnapshot {
  const { yearMonth, monthlyBudget, actualFlexibleSpent, actualExcludedSpent,
    actualIncome, availableAtStart, availableAtEnd } = input;

  return {
    year_month: yearMonth,
    allocated_budget: monthlyBudget.free,
    fixed_total: monthlyBudget.fixed,
    installment_total: monthlyBudget.installments,
    planned_total: monthlyBudget.planned,
    flexible_spent: actualFlexibleSpent,
    excluded_spent: actualExcludedSpent,
    income_total: actualIncome,
    available_at_start: availableAtStart,
    available_at_end: availableAtEnd,
  };
}
