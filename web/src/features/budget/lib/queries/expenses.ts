import { query, queryOne } from '@/lib/db';
import { getBillingMonthForExpense } from '../billing/card-billing';
import { DEFAULT_PAYMENT_METHOD } from '../billing/payment-methods';
import type { ExpenseRow } from '../types';

// ─── 지출 CRUD ───────────────────────────────────────

/** 기간별 지출 조회 (최신순) */
export async function queryExpenses(
  userId: number,
  from: string,
  to: string,
  category?: string,
  plannedExpenseId?: number,
): Promise<ExpenseRow[]> {
  const conditions = ['user_id = $1', 'date >= $2', 'date <= $3'];
  const params: unknown[] = [userId, from, to];
  if (category) {
    conditions.push(`category = $${params.length + 1}`);
    params.push(category);
  }
  if (plannedExpenseId) {
    conditions.push(`planned_expense_id = $${params.length + 1}`);
    params.push(plannedExpenseId);
  }
  const { rows } = await query<ExpenseRow>(
    `SELECT id, date::text, amount, category, description, payment_method,
            is_installment, installment_num, installment_total, installment_group,
            source, memo, COALESCE(type, 'expense') as type, planned_expense_id, created_at::text,
            COALESCE(exclude_from_budget, false) as exclude_from_budget,
            COALESCE(distribute_to_budget, false) as distribute_to_budget
     FROM expenses
     WHERE ${conditions.join(' AND ')}
     ORDER BY date DESC, created_at DESC`,
    params,
  );
  return rows;
}

/** billing_month 기준 지출 목록 조회 (카드별 결제주기 반영) */
export async function queryExpensesByBillingMonth(
  userId: number,
  billingMonth: string,
  category?: string,
): Promise<ExpenseRow[]> {
  const conditions = ['user_id = $1', 'billing_month = $2'];
  const params: unknown[] = [userId, billingMonth];
  if (category) {
    conditions.push(`category = $${params.length + 1}`);
    params.push(category);
  }
  const { rows } = await query<ExpenseRow>(
    `SELECT id, date::text, amount, category, description, payment_method,
            is_installment, installment_num, installment_total, installment_group,
            source, memo, COALESCE(type, 'expense') as type, planned_expense_id, created_at::text,
            COALESCE(exclude_from_budget, false) as exclude_from_budget,
            COALESCE(distribute_to_budget, false) as distribute_to_budget
     FROM expenses
     WHERE ${conditions.join(' AND ')}
     ORDER BY date DESC, created_at DESC`,
    params,
  );
  return rows;
}

/** 지출 단건 조회 */
export async function queryExpense(userId: number, id: number): Promise<ExpenseRow | null> {
  return queryOne<ExpenseRow>(
    `SELECT id, date::text, amount, category, description, payment_method,
            is_installment, installment_num, installment_total, installment_group,
            source, memo, COALESCE(type, 'expense') as type, planned_expense_id, created_at::text,
            COALESCE(exclude_from_budget, false) as exclude_from_budget,
            COALESCE(distribute_to_budget, false) as distribute_to_budget
     FROM expenses WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
}

/** 지출/수입 추가 */
export async function createExpense(
  userId: number,
  data: {
    date: string;
    amount: number;
    category: string;
    description?: string | null;
    payment_method?: string;
    memo?: string | null;
    type?: 'expense' | 'income';
    planned_expense_id?: number | null;
    exclude_from_budget?: boolean;
    distribute_to_budget?: boolean;
  },
): Promise<ExpenseRow> {
  const billingMonth = getBillingMonthForExpense(
    data.date,
    data.payment_method ?? DEFAULT_PAYMENT_METHOD,
  );
  const row = await queryOne<ExpenseRow>(
    `INSERT INTO expenses (user_id, date, amount, category, description, payment_method, memo, source, type, planned_expense_id, exclude_from_budget, distribute_to_budget, billing_month)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'manual', $8, $9, $10, $11, $12)
     RETURNING id, date::text, amount, category, description, payment_method,
               is_installment, installment_num, installment_total, installment_group,
               source, memo, COALESCE(type, 'expense') as type, planned_expense_id, created_at::text,
               COALESCE(exclude_from_budget, false) as exclude_from_budget,
               COALESCE(distribute_to_budget, false) as distribute_to_budget`,
    [
      userId,
      data.date,
      data.amount,
      data.category,
      data.description ?? null,
      data.payment_method ?? DEFAULT_PAYMENT_METHOD,
      data.memo ?? null,
      data.type ?? 'expense',
      data.planned_expense_id ?? null,
      data.exclude_from_budget ?? false,
      data.distribute_to_budget ?? false,
      billingMonth,
    ],
  );
  if (!row) throw new Error('createExpense: INSERT returned no rows');
  return row;
}

/** 할부 지출 다건 생성 (총액 기준, 월별 분할) */
export async function createInstallmentExpenses(
  userId: number,
  data: {
    date: string;
    totalAmount: number;
    months: number;
    category: string;
    description?: string | null;
    payment_method?: string;
    memo?: string | null;
    type?: 'expense' | 'income';
  },
): Promise<ExpenseRow> {
  const monthlyAmount = Math.round(data.totalAmount / data.months);
  // 끝전 보정: 마지막 회차에서 나머지 흡수
  const lastMonthAmount = data.totalAmount - monthlyAmount * (data.months - 1);
  const groupId = crypto.randomUUID();
  // 할부는 예외 없이 묶인 돈 — exclude_from_budget=true 조합은 존재할 수 없다 (#549, 마이그 095의
  // CHECK 제약). 호출부가 제외 토글 값을 넘길 수 없도록 파라미터 자체를 두지 않고 false로 고정한다.
  const excludeFromBudget = false;

  // 할부 회차는 등록 시점에 자산을 차감하지 않는다 (#539, ADR 0051).
  // 목표 기간 창 안 회차는 묶인 돈(reservation)으로 라이브 계산되고, 실제 자금 차감은
  // 각 회차가 결제되는 주기의 정산에서 한 번만 일어난다(depletion). 건별 토글도 제거.
  let firstRow: ExpenseRow | null = null;

  for (let i = 0; i < data.months; i++) {
    const amount = i === data.months - 1 ? lastMonthAmount : monthlyAmount;

    // 첫 회차 날짜 기준 i개월 후 계산
    const baseDate = new Date(`${data.date}T00:00:00`);
    baseDate.setMonth(baseDate.getMonth() + i);
    const expDate = `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}-${String(baseDate.getDate()).padStart(2, '0')}`;
    const billingMonth = getBillingMonthForExpense(
      expDate,
      data.payment_method ?? DEFAULT_PAYMENT_METHOD,
    );

    const row = await queryOne<ExpenseRow>(
      `INSERT INTO expenses (user_id, date, amount, category, description, payment_method,
                             is_installment, installment_num, installment_total, installment_group,
                             memo, source, type, exclude_from_budget, billing_month)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8, $9, $10, 'manual', $11, $12, $13)
       RETURNING id, date::text, amount, category, description, payment_method,
                 is_installment, installment_num, installment_total, installment_group,
                 source, memo, COALESCE(type, 'expense') as type, planned_expense_id, created_at::text,
                 COALESCE(exclude_from_budget, false) as exclude_from_budget,
                 COALESCE(distribute_to_budget, false) as distribute_to_budget`,
      [
        userId,
        expDate,
        amount,
        data.category,
        data.description ?? null,
        data.payment_method ?? DEFAULT_PAYMENT_METHOD,
        i + 1,
        data.months,
        groupId,
        data.memo ?? null,
        data.type ?? 'expense',
        excludeFromBudget,
        billingMonth,
      ],
    );
    if (i === 0) firstRow = row ?? null;
  }

  if (!firstRow) throw new Error('createInstallmentExpenses: INSERT returned no rows');

  return firstRow;
}

/** 지출 수정 (허용 컬럼 화이트리스트) */
const EXPENSE_COLUMNS = new Set([
  'date',
  'amount',
  'category',
  'description',
  'payment_method',
  'memo',
  'type',
  'planned_expense_id',
  'exclude_from_budget',
  'distribute_to_budget',
]);

/** source='fixed' 행의 exclude_from_budget 변경 시도 시 throw되는 sentinel error */
export const FIXED_SOURCE_EXCLUDE_LOCKED = 'FIXED_SOURCE_EXCLUDE_LOCKED';

// 지출 수정은 화이트리스트 컬럼 단순 UPDATE (#539, ADR 0051).
// 등록 시점 자산 차감을 폐지했으므로 amount 변경·할부 토글에 따른 자산 보정 로직이 사라졌다.
// 묶인 돈은 목표 기간 창 라이브 계산이라 수정 즉시 다음 예산 조회에 자동 반영된다.
export async function updateExpense(
  userId: number,
  id: number,
  updates: Record<string, unknown>,
): Promise<ExpenseRow | null> {
  const keys = Object.keys(updates).filter((k) => EXPENSE_COLUMNS.has(k));
  if (keys.length === 0) return queryExpense(userId, id);

  // source='fixed' 행: 자유지출/고정비 이중 카운트 방지 — exclude_from_budget "변경"만 차단.
  // 같은 값을 다시 보내는 저장(금액만 고치는 경우)은 통과시킨다. 변동 고정비는 정의(fixed_costs.amount)가
  // 아니라 그 달 지출 행에서 실제 금액을 고치기 때문 (#615).
  if (keys.includes('exclude_from_budget')) {
    const existing = await queryOne<{ source: string | null; exclude_from_budget: boolean }>(
      `SELECT source, COALESCE(exclude_from_budget, false) AS exclude_from_budget
       FROM expenses WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    if (
      existing?.source === 'fixed' &&
      existing.exclude_from_budget !== Boolean(updates.exclude_from_budget)
    ) {
      throw new Error(FIXED_SOURCE_EXCLUDE_LOCKED);
    }
  }

  // 날짜·결제수단이 바뀌면 귀속 월을 다시 계산한다. 결제수단이 출금 시점까지 좌우하므로
  // 귀속 월만 옛 값으로 남으면 복원·정산이 어긋난다 (#615).
  // EXPENSE_COLUMNS 화이트리스트는 그대로 두고 서버 계산값만 별도로 붙인다.
  const derived: Record<string, unknown> = {};
  if (keys.includes('date') || keys.includes('payment_method')) {
    const current = await queryExpense(userId, id);
    if (current) {
      const nextDate = (updates.date as string | undefined) ?? current.date;
      const nextMethod = (updates.payment_method as string | undefined) ?? current.payment_method;
      derived.billing_month = getBillingMonthForExpense(nextDate, nextMethod);
    }
  }

  const allKeys = [...keys, ...Object.keys(derived)];
  const setClauses = allKeys.map((k, i) => `${k} = $${i + 3}`);
  const values = allKeys.map((k) => (k in derived ? derived[k] : updates[k]));
  return queryOne<ExpenseRow>(
    `UPDATE expenses SET ${setClauses.join(', ')}
     WHERE id = $1 AND user_id = $2
     RETURNING id, date::text, amount, category, description, payment_method,
               is_installment, installment_num, installment_total, installment_group,
               source, memo, COALESCE(type, 'expense') as type, planned_expense_id, created_at::text,
               COALESCE(exclude_from_budget, false) as exclude_from_budget,
               COALESCE(distribute_to_budget, false) as distribute_to_budget`,
    [id, userId, ...values],
  );
}

/** 지출 삭제 — 등록 시점 차감 폐지로 자산 복원 불필요 (#539) */
export async function deleteExpense(userId: number, id: number): Promise<boolean> {
  const result = await query('DELETE FROM expenses WHERE id = $1 AND user_id = $2', [id, userId]);
  return (result.rowCount ?? 0) > 0;
}
