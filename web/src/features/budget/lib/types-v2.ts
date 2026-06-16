// ─── 빌링 ──────────────────────────────────────────────────────

export interface BillingCycle {
  yearMonth: string; // 'YYYY-MM'
  from: string; // 'YYYY-MM-DD' (전월 16일)
  to: string; // 'YYYY-MM-DD' (당월 15일)
  totalDays: number;
}

// ─── 월별 분배 ──────────────────────────────────────────────────

export interface PlannedInput {
  yearMonth: string;
  amount: number;
}

export interface MonthAllocatorInput {
  totalAvailable: number;
  fixedMonthly: number;
  /**
   * 목표 기간 창 안 할부 락 — billing_month별 합계 (#539, ADR 0051).
   * 각 달의 묶인 돈(할부 reservation). 창 밖 회차는 애초에 조회되지 않아 제외됨.
   */
  installmentLockByMonth: Map<string, number>;
  plannedExpenses: PlannedInput[];
  currentBillingMonth: string;
  targetMonth: string | null;
  today: string; // 'YYYY-MM-DD'
  /** 이번 달에만 쓰는 수입 (distribute_to_budget=false) — 현재 월 free 에 독점 귀속 */
  currentMonthOnlyIncome?: number;
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
  /** 이번달 자유 예산 (currentMonth.free, 수입 포함된 값) */
  monthBudget: number;
  /** 사이클 시작부터 오늘까지 누적 자유 지출 */
  flexibleSpent: number;
  /** 오늘 자유 지출 */
  todayFlexSpent: number;
  /** 결제주기 총 일자 */
  cycleTotalDays: number;
  /** 오늘 포함 결제주기 끝까지 남은 일자 (1 이상) */
  daysFromToday: number;
  /** 이번달 분배 수입 (currentMonthOnlyIncome) — base 산출 시 차감 */
  currentMonthIncome: number;
}

export interface DayAllocatorResult {
  /** 기준 일 예산 — 사이클 시작 시 약속, 수입 미반영 base / cycleTotalDays */
  todayBudget: number;
  /** 오늘 예산 — 동적, max(0, 잔여 / 남은 일자) */
  todayRecommended: number;
  /** 오늘 남음/초과 = todayRecommended − todayFlexSpent */
  todayRemaining: number;
  /** 이번달 잔여 = monthBudget − flexibleSpent (음수 가능) */
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
