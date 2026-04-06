// ─── 카테고리 (공통) ─────────────────────────────────

export type CategoryType = 'task' | 'event';

export const CATEGORY_TYPES: { value: CategoryType; label: string }[] = [
  { value: 'task', label: '할일' },
  { value: 'event', label: '일정' },
];

export interface CategoryRow {
  id: number;
  name: string;
  color: string;
  type: CategoryType;
  sort_order: number;
  parent_id: number | null;
}

// ─── 색상 시스템 (공통) ──────────────────────────────

/** 프리셋 색상 (파스텔 hex) */
export const PRESET_COLORS: Record<string, string> = {
  violet: '#ddd6fe',
  amber: '#fde68a',
  rose: '#fecdd3',
  emerald: '#a7f3d0',
  sky: '#bae6fd',
  blue: '#bfdbfe',
  orange: '#fed7aa',
  pink: '#fbcfe8',
  teal: '#99f6e4',
  indigo: '#c7d2fe',
  gray: '#e5e7eb',
};

/** hex 색상의 상대 밝기 (0~1) */
function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** hex 값에서 배경색 기반 스타일 생성 (색상 → 배경, 텍스트 자동 결정) */
export function hexToStyles(hex: string): { bg: string; border: string; text: string } {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const textColor = luminance(hex) > 0.45 ? '#1f2937' : '#ffffff';
  return {
    bg: `rgba(${r}, ${g}, ${b}, 0.85)`,
    border: `rgba(${r}, ${g}, ${b}, 1)`,
    text: textColor,
  };
}

/** 색상 키(프리셋명 또는 hex)에서 인라인 스타일 생성 */
export function getCategoryStyle(colorKey: string): { bg: string; border: string; text: string } {
  const hex = colorToHex(colorKey);
  return hexToStyles(hex);
}

/** 색상 키에서 hex 값 가져오기 */
export function colorToHex(colorKey: string): string {
  return PRESET_COLORS[colorKey] ?? (colorKey.startsWith('#') ? colorKey : '#6b7280');
}

export const COLOR_OPTIONS = Object.keys(PRESET_COLORS);

// ─── 유틸리티 (공통) ─────────────────────────────────

/** 금액 포맷: 1234567 → "1,234,567원" */
export function formatAmount(amount: number): string {
  return `${amount.toLocaleString('ko-KR')}원`;
}

// ─── 지출 관리 ────────────────────────────────────────

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
  by_category: CategoryStat[];
  daily_avg: number;
}

/** 지출 카테고리 목록 (위플 기준) */
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

/** 금액 포맷: 1234567 → "1,234,567원" */
export function formatAmount(amount: number): string {
  return `${amount.toLocaleString('ko-KR')}원`;
}
