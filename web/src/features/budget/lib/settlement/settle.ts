import type { SettlementInput, SettlementSnapshot } from '../types-v2';

/** 월 경계 시점에 스냅샷 구조 생성 (DB 저장은 호출자가 담당) */
export function buildSettlementSnapshot(input: SettlementInput): SettlementSnapshot {
  const {
    yearMonth,
    monthlyBudget,
    actualFlexibleSpent,
    actualExcludedSpent,
    actualIncome,
    availableAtStart,
    availableAtEnd,
  } = input;

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
