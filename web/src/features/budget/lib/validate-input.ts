import { validateFields } from '@/lib/validation';
import { isKnownPaymentMethod } from './billing/payment-methods';
import { ALL_EXPENSE_CATEGORIES, INCOME_CATEGORIES, VALID_CATEGORIES } from './types';

/** 지출·고정비·예정지출 API 입력 검증 (route 공용 순수 함수) */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^\d+$/;
const VALID_EXPENSE_CATEGORIES = new Set<string>(ALL_EXPENSE_CATEGORIES);
const VALID_INCOME_CATEGORIES = new Set<string>(INCOME_CATEGORIES);

/** 할부로 저장하는 개월 수 범위. 없음·1은 일시불 */
export const MIN_INSTALLMENT_MONTHS = 2;
export const MAX_INSTALLMENT_MONTHS = 12;

/** 검증 결과 — 실패면 error, 성공이면 정규화된 data */
export type ParseResult<T> = { error: string } | { data: T };

/** 양의 정수 여부 (금액·ID 공용) */
export function isPositiveInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
}

/** 0 이상 정수 여부 (자금 잔액처럼 0을 허용하는 금액) */
export function isNonNegativeInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

/** 경로·쿼리 문자열 ID를 양의 정수로 변환. '1.5'·'12abc'·'0'은 null */
export function parseIdParam(raw: string | null | undefined): number | null {
  if (!raw || !ID_RE.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** 할부 개월 수 — 없음·1은 일시불(1), 2~12는 할부, 그 밖은 에러 */
export function parseInstallmentMonths(v: unknown): ParseResult<number> {
  if (v === undefined || v === null || v === 1) return { data: 1 };
  if (
    typeof v !== 'number' ||
    !Number.isInteger(v) ||
    v < MIN_INSTALLMENT_MONTHS ||
    v > MAX_INSTALLMENT_MONTHS
  ) {
    return {
      error: `installment_months는 ${MIN_INSTALLMENT_MONTHS}~${MAX_INSTALLMENT_MONTHS} 사이 정수이거나 1(일시불)이어야 합니다`,
    };
  }
  return { data: v };
}

/** 문자열 또는 null만 허용하는 필드인가 (값이 없으면 통과) */
function isOptionalStringOrNull(v: unknown): boolean {
  return v === undefined || v === null || typeof v === 'string';
}

/**
 * 지출 입력 필드 검증 (POST·PATCH 공용). 통과하면 null, 실패하면 에러 메시지.
 *
 * - create: date·amount·category는 필수. category는 type(기본 expense)에 맞는 목록으로 본다.
 * - update: 보낸 필드만 본다. type을 같이 보내면 그 type의 목록, 아니면 전체 목록으로 category를 본다.
 *
 * 예정 지출 소유 여부는 DB 조회가 필요해 route가 따로 확인한다.
 */
export function validateExpenseFields(
  b: Record<string, unknown>,
  mode: 'create' | 'update',
): string | null {
  const has = (key: string): boolean => (mode === 'create' ? true : key in b);

  if (has('date') && (typeof b.date !== 'string' || !DATE_RE.test(b.date))) {
    return 'date가 필요합니다 (YYYY-MM-DD)';
  }
  if (has('amount') && !isPositiveInteger(b.amount)) {
    return 'amount는 양수 정수여야 합니다';
  }

  const typeGiven = mode === 'create' ? b.type !== undefined : 'type' in b;
  if (typeGiven && b.type !== 'expense' && b.type !== 'income') {
    return 'type은 expense 또는 income이어야 합니다';
  }

  if (has('category')) {
    const entryType = mode === 'create' ? (b.type ?? 'expense') : typeGiven ? b.type : undefined;
    const validSet =
      entryType === 'income'
        ? VALID_INCOME_CATEGORIES
        : entryType === 'expense'
          ? VALID_EXPENSE_CATEGORIES
          : VALID_CATEGORIES;
    if (typeof b.category !== 'string' || !validSet.has(b.category)) {
      return '유효하지 않은 category입니다';
    }
  }

  if (!isOptionalStringOrNull(b.description)) return 'description은 문자열이어야 합니다';
  if (!isOptionalStringOrNull(b.memo)) return 'memo는 문자열이어야 합니다';
  // 결제수단은 지울 수 없다 — 귀속 월 계산 기준이라 POST는 생략·null이면 기본값, PATCH는 문자열만 받는다
  const methodGiven = mode === 'create' ? b.payment_method != null : 'payment_method' in b;
  if (methodGiven && typeof b.payment_method !== 'string') {
    return 'payment_method는 문자열이어야 합니다';
  }

  const lengthError = validateFields([
    [b.description, 'description'],
    [b.memo, 'memo'],
    [b.payment_method, 'paymentMethod'],
  ]);
  if (lengthError) return lengthError;

  if (b.planned_expense_id != null && !isPositiveInteger(b.planned_expense_id)) {
    return 'planned_expense_id는 양의 정수여야 합니다';
  }

  if (mode === 'update') {
    for (const key of ['exclude_from_budget', 'distribute_to_budget'] as const) {
      if (key in b && typeof b[key] !== 'boolean') return `${key}는 boolean이어야 합니다`;
    }
  }
  return null;
}

// ─── 고정비 ───────────────────────────────────────────

export type FixedCostCreateInput = {
  name: string;
  amount: number;
  category?: string | null;
  day_of_month?: number | null;
  payment_method?: string | null;
};

/** PATCH로 바꿀 수 있는 고정비 필드. 없는 키는 바꾸지 않는다 */
export type FixedCostUpdateInput = Partial<FixedCostCreateInput> & {
  is_variable?: boolean;
  active?: boolean;
  memo?: string | null;
};

/**
 * 고정비 필드별 검증 — 보낸 필드만 보고, 통과한 값만 모아 돌려준다.
 * NOT NULL 컬럼(name·amount)과 boolean 컬럼은 null을 받지 않고,
 * nullable 컬럼(category·day_of_month·payment_method·memo)은 null을 지우기 값으로 받는다.
 */
function collectFixedCostFields(b: Record<string, unknown>): ParseResult<FixedCostUpdateInput> {
  const out: FixedCostUpdateInput = {};

  if ('name' in b) {
    if (typeof b.name !== 'string' || !b.name.trim()) return { error: '이름을 입력해주세요' };
    out.name = b.name.trim();
  }
  if ('amount' in b) {
    if (!isPositiveInteger(b.amount)) return { error: '금액은 양의 정수여야 합니다' };
    out.amount = b.amount;
  }
  if ('category' in b) {
    if (b.category !== null && typeof b.category !== 'string') {
      return { error: 'category는 문자열이어야 합니다' };
    }
    out.category = b.category;
  }
  if ('day_of_month' in b) {
    const day = b.day_of_month;
    if (day !== null && (typeof day !== 'number' || !Number.isInteger(day) || day < 1 || day > 31)) {
      return { error: '결제일은 1~31 사이 정수여야 합니다' };
    }
    out.day_of_month = day;
  }
  if ('payment_method' in b) {
    const method = b.payment_method;
    if (method !== null && (typeof method !== 'string' || !isKnownPaymentMethod(method))) {
      return { error: '등록되지 않은 결제수단입니다' };
    }
    out.payment_method = method;
  }
  for (const key of ['is_variable', 'active'] as const) {
    if (key in b) {
      const value = b[key];
      if (typeof value !== 'boolean') return { error: `${key}는 boolean이어야 합니다` };
      out[key] = value;
    }
  }
  if ('memo' in b) {
    if (b.memo !== null && typeof b.memo !== 'string') return { error: 'memo는 문자열이어야 합니다' };
    out.memo = b.memo;
  }

  const lengthError = validateFields([
    [out.name, 'name'],
    [out.category, 'category'],
    [out.memo, 'memo'],
  ]);
  if (lengthError) return { error: lengthError };

  return { data: out };
}

/** 고정비 생성 입력. 생략한 필드는 검증하지 않는다(undefined는 값이 없는 것으로 본다) */
export function parseFixedCostCreate(body: unknown): ParseResult<FixedCostCreateInput> {
  if (typeof body !== 'object' || body === null) return { error: '요청 본문이 올바르지 않습니다' };
  const b = body as Record<string, unknown>;
  if (!('name' in b)) return { error: '이름을 입력해주세요' };
  if (!('amount' in b)) return { error: '금액은 양의 정수여야 합니다' };

  const { name, amount, category, day_of_month, payment_method } = b;
  const result = collectFixedCostFields(
    Object.fromEntries(
      Object.entries({ name, amount, category, day_of_month, payment_method }).filter(
        ([, v]) => v !== undefined,
      ),
    ),
  );
  if ('error' in result) return result;
  const d = result.data;
  return {
    data: {
      name: d.name as string,
      amount: d.amount as number,
      category: d.category,
      day_of_month: d.day_of_month,
      payment_method: d.payment_method,
    },
  };
}

/** 고정비 수정 입력. 허용 필드만 남기고, 바꿀 필드가 없으면 에러 */
export function parseFixedCostUpdate(body: unknown): ParseResult<FixedCostUpdateInput> {
  if (typeof body !== 'object' || body === null) return { error: '요청 본문이 올바르지 않습니다' };
  const result = collectFixedCostFields(body as Record<string, unknown>);
  if ('error' in result) return result;
  if (Object.keys(result.data).length === 0) return { error: '수정할 항목이 없습니다' };
  return result;
}

// ─── 예정 지출 ────────────────────────────────────────

/** planned_expenses.memo 컬럼 길이 (VARCHAR(200)) */
const PLANNED_MEMO_MAX = 200;

/** 예정 지출 memo — 문자열·null·생략만, 200자 이하 */
export function validatePlannedMemo(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return 'memo는 문자열이어야 합니다';
  if (v.length > PLANNED_MEMO_MAX) {
    return `memo는 ${PLANNED_MEMO_MAX}자 이하여야 합니다 (현재 ${v.length}자)`;
  }
  return null;
}

// ─── 카테고리 한도 ────────────────────────────────────

/** category_limits.target_count 범위 (CHECK 1~50) */
const MIN_TARGET_COUNT = 1;
const MAX_TARGET_COUNT = 50;

/** 주기당 한도 횟수 — 1~50 정수 */
export function isValidTargetCount(v: unknown): v is number {
  return (
    typeof v === 'number' && Number.isInteger(v) && v >= MIN_TARGET_COUNT && v <= MAX_TARGET_COUNT
  );
}

/** 한도를 걸 수 있는 카테고리 — 지출 카테고리 목록만 */
export function isValidLimitCategory(v: unknown): v is string {
  return typeof v === 'string' && VALID_EXPENSE_CATEGORIES.has(v);
}
