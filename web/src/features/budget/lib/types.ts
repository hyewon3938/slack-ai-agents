export interface ExpenseRow {
  id: number;
  date: string;
  amount: number;
  category: string;
  description: string | null;
  payment_method: string;
  is_installment: boolean;
  installment_num: number | null;
  installment_total: number | null;
  installment_group: string | null;
  source: string;
  memo: string | null;
  type: 'expense' | 'income';
  planned_expense_id: number | null;
  created_at?: string;
  /** 예산 계산에서 제외할지 여부. true면 자유 지출에 포함 안 됨 */
  exclude_from_budget: boolean;
  /** 수입을 전체 기간에 분배할지 여부 (type='income'에서만 사용) */
  distribute_to_budget: boolean;
}

export interface PlannedExpenseRow {
  id: number;
  year_month: string;
  amount: number;
  memo: string | null;
  /** 연결된 실제 지출 합계 */
  used_amount?: number;
  created_at?: string;
}

export interface FixedCostRow {
  id: number;
  name: string;
  amount: number;
  category: string | null;
  is_variable: boolean;
  day_of_month: number | null;
  active: boolean;
  memo: string | null;
  /** 자동 기록에 쓸 결제수단. NULL이면 기본 결제수단으로 폴백 */
  payment_method: string | null;
}

export interface BudgetRow {
  id: number;
  year_month: string;
  total_budget: number | null;
  daily_budget: number | null;
  notes: string | null;
}

export interface AssetRow {
  id: number;
  name: string;
  balance: number;
  type: string;
  available_amount: number | null;
  is_emergency: boolean;
  /** 자동 차감 우선순위 자산 (user당 최대 1개) */
  is_default: boolean;
  memo: string | null;
  updated_at: string;
  /** 이 잔액이 며칠까지의 입출금을 반영한 값인가 (#615, ADR 0062) */
  balance_as_of: string | null;
}

export interface CategoryStat {
  category: string;
  total: number;
  count: number;
}

export interface CategoryLimitRow {
  id: number;
  user_id: number;
  category: string;
  target_count: number;
  created_at: string;
  updated_at: string;
}

export interface CategoryLimitWithUsage {
  id: number;
  category: string;
  target_count: number;
  used_count: number;
}

export interface MonthSummary {
  year_month: string;
  total: number;
  budget: BudgetRow | null;
  fixed_total: number;
  variable_total: number;
  /** 할부 합계 (이미 확정된 지출, 가변 카테고리 중 is_installment=true) */
  installment_total: number;
  /** 자유 지출 (가변 지출 중 할부 제외 = 내가 직접 쓴 돈) */
  flexible_spent: number;
  /** 수입 합계 (type='income'인 건) */
  income_total: number;
  /** 예정 지출 합계 */
  planned_total: number;
  /** 자동 산정 월 자유 예산 (런웨이 기반) */
  auto_budget: number | null;
  /** 자동 산정 동적 일일 자유 예산 */
  auto_daily: number | null;
  /** 이번 달 남은 자유 예산 (현재 달 전용) */
  month_budget_remaining: number | null;
  /** 기준 일 예산 — 사이클 시작 시 약속, 사이클 동안 사실상 불변 (보조 표시용) */
  today_budget: number | null;
  /** 오늘 예산 — 동적 권장값, 잔여/남은일자 (메인 표시용) */
  today_recommended: number | null;
  /** 오늘 자유 지출 (현재 달 전용) */
  today_flex_spent: number | null;
  /** 오늘 남음(양수)/초과(음수) — todayRecommended 기준 */
  today_remaining: number | null;
  by_category: CategoryStat[];
  daily_avg: number;
}

/** 일별 예산 로그 (스냅샷) */
export interface DailyBudgetLog {
  date: string;
  billing_month: string;
  budget: number; // 그날 할당 예산
  spent: number; // 그날 자유 지출
  saved: number; // budget - spent (음수 = 초과)
}

/** 월별 시뮬레이션 프로젝션 */
export interface MonthProjection {
  month: string; // YYYY-MM (결제주기 기준)
  fixed: number; // 고정비
  installments: number; // 할부 합계
  locked: number; // fixed + installments (줄일 수 없는 돈)
  free_budget: number; // 자유 예산
  income: number; // 수입
  net_burn: number; // locked + free_budget - income
  remaining: number; // 남은 가용자금
}

/**
 * 예산 제외 기본 카테고리 (UI 토글 기본값 결정용).
 * SQL 쿼리에서는 사용하지 않음 — exclude_from_budget 컬럼으로 판단.
 */
export const BUDGET_EXCLUDED_CATEGORIES = new Set([
  '통신비',
  '공과금',
  '리커밋 사업',
  '리커밋 택배',
  '세금',
]);

/** 하루 최소 자유 예산 경고 기준 (원) */
export const MIN_DAILY_BUDGET = 10000;

/** 지출 카테고리 목록 */
export const EXPENSE_CATEGORIES = [
  '식재료',
  '배달음식',
  '외식비',
  '카페',
  '생필품',
  '쇼핑',
  '미용',
  '교통비',
  '의료/건강',
  '구독료',
  '통신비',
  '공과금',
  '문화생활',
  '여행',
  '경조사',
  '고양이',
  '리커밋 사업',
  '리커밋 택배',
  '세금',
  '기타',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/** 수입 카테고리 목록 */
export const INCOME_CATEGORIES = ['환불', '수입', '기타수입'] as const;

export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];

/** 고정지출 카테고리 목록 */
export const FIXED_COST_CATEGORIES = ['주거', '보험', '통신', '구독', '교육', '기타'] as const;

/** 지출 select에 표시·검증할 전체 카테고리 (일반 지출 + 고정비 카테고리). 고정비 자동 생성 지출도 수정 가능하도록 둘 다 포함. */
export const ALL_EXPENSE_CATEGORIES: readonly string[] = Array.from(
  new Set<string>([...EXPENSE_CATEGORIES, ...FIXED_COST_CATEGORIES]),
);
