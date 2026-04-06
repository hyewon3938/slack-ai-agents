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
  memo: string | null;
  updated_at: string;
}

export interface CategoryStat {
  category: string;
  total: number;
  count: number;
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
  by_category: CategoryStat[];
  daily_avg: number;
}

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
  '환불',
  '기타',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
