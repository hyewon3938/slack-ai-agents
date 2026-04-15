// ─── 빌링 ──────────────────────────────────────────────────────

export interface BillingCycle {
  yearMonth: string;   // 'YYYY-MM'
  from: string;        // 'YYYY-MM-DD' (전월 16일)
  to: string;          // 'YYYY-MM-DD' (당월 15일)
  totalDays: number;
}

// ─── 월별 분배 ──────────────────────────────────────────────────

export interface InstallmentInput {
  monthlyAmount: number;
  remainingCount: number;
}

export interface PlannedInput {
  yearMonth: string;
  amount: number;
}

export interface MonthAllocatorInput {
  totalAvailable: number;
  fixedMonthly: number;
  installments: InstallmentInput[];
  plannedExpenses: PlannedInput[];
  currentBillingMonth: string;
  targetMonth: string | null;
  today: string;        // 'YYYY-MM-DD'
}

export interface MonthlyBudget {
  yearMonth: string;
  allocatedDays: number;
  fixed: number;
  installments: number;
  planned: number;
  free: number;
  isCurrent: boolean;
}

export interface MonthAllocatorResult {
  monthlyBudgets: MonthlyBudget[];
  dailyFree: number;
  freePerMonth: number | null;
  totalLocked: number;
}

// ─── 일별 분배 ──────────────────────────────────────────────────

export interface DayAllocatorInput {
  monthBudget: number;
  flexibleSpent: number;
  todayFlexSpent: number;
  cycleRemainingDays: number;
}

export interface DayAllocatorResult {
  todayBudget: number;
  todayRemaining: number;
  monthBudgetRemaining: number;
}

// ─── 정산 ───────────────────────────────────────────────────────

export interface SettlementInput {
  yearMonth: string;
  monthlyBudget: MonthlyBudget;
  actualFlexibleSpent: number;
  actualExcludedSpent: number;
  actualIncome: number;
  availableAtStart: number;
  availableAtEnd: number;
}

export interface SettlementSnapshot {
  year_month: string;
  allocated_budget: number;
  fixed_total: number;
  installment_total: number;
  planned_total: number;
  flexible_spent: number;
  excluded_spent: number;
  income_total: number;
  available_at_start: number;
  available_at_end: number;
}
