import { query, queryOne } from '@/lib/db';
import { getTodayISO } from '@/lib/kst';
import { getTodayAllocation } from './facade';
import { getCurrentBillingMonth, getBillingRange, calcCycleDays } from './billing/cycle';
import { getBillingMonthForExpense } from './billing/card-billing';
import { DEFAULT_PAYMENT_METHOD } from './billing/payment-methods';
import { readFlexibleSpent, readTodayFlexSpent } from './repository/expenses-repo';
import { queryFixedCosts, ensureFixedCostExpenses } from './fixed-cost-ensure';
import type {
  ExpenseRow,
  FixedCostRow,
  AssetRow,
  MonthSummary,
  CategoryStat,
  PlannedExpenseRow,
  DailyBudgetLog,
} from './types';

// 고정비 조회·자동기록은 순환 import(queries → facade → queries) 방지를 위해 별도 모듈로 이동.
// 기존 import 경로 호환을 위해 여기서 재수출한다.
export { queryFixedCosts, ensureFixedCostExpenses };

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

// ─── 월간 요약 ────────────────────────────────────────

/**
 * 월간 요약: 총 지출, 카테고리별, 예산 대비.
 * 카드 결제주기 기준: 전월 16일 ~ 당월 15일.
 */
export async function queryMonthSummary(userId: number, yearMonth: string): Promise<MonthSummary> {
  const { from, to } = getBillingRange(yearMonth);

  const [totalResult, categoryResult, fixedCosts] = await Promise.all([
    query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0) as total FROM expenses
       WHERE user_id = $1 AND billing_month = $2 AND COALESCE(type, 'expense') = 'expense'`,
      [userId, yearMonth],
    ),
    query<{ category: string; total: string; count: string }>(
      `SELECT category, SUM(amount) as total, COUNT(*) as count
       FROM expenses WHERE user_id = $1 AND billing_month = $2
         AND COALESCE(type, 'expense') = 'expense'
       GROUP BY category ORDER BY SUM(amount) DESC`,
      [userId, yearMonth],
    ),
    queryFixedCosts(userId),
  ]);

  const total = Number(totalResult.rows[0]?.total ?? 0);
  const fixedTotal = fixedCosts.filter((fc) => fc.active).reduce((s, fc) => s + fc.amount, 0);
  const byCategory: CategoryStat[] = categoryResult.rows.map((r) => ({
    category: r.category,
    total: Number(r.total),
    count: Number(r.count),
  }));

  // 자유 지출 합계 (exclude_from_budget=false인 비할부만).
  // 할부는 묶인 돈이라 자유지출·일평균(daily_avg)에서 분리 (#539/ADR 0051, #549).
  const variableResult = await queryOne<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0) as total FROM expenses
     WHERE user_id = $1 AND billing_month = $2
       AND exclude_from_budget = false
       AND is_installment = false
       AND COALESCE(type, 'expense') = 'expense'`,
    [userId, yearMonth],
  );
  const variableTotal = Number(variableResult?.total ?? 0);

  // 할부 합계 (is_installment=true인 것 전부 — 락 계산 readInstallmentLockByMonth와 동일 집합).
  // exclude 필터 없음: 할부는 예외 없이 묶인 돈이라 표시가 실제 락과 어긋나면 안 됨 (#549).
  const installmentResult = await query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0) as total FROM expenses
     WHERE user_id = $1 AND billing_month = $2
       AND is_installment = true
       AND COALESCE(type, 'expense') = 'expense'`,
    [userId, yearMonth],
  );
  const installmentTotal = Number(installmentResult.rows[0]?.total ?? 0);

  // 자유 지출 정의는 readFlexibleSpent 단일 정의에 의존 (SSOT)
  const flexibleSpent = await readFlexibleSpent(userId, yearMonth, to);

  // 수입 합계 (type='income')
  const incomeResult = await query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0) as total FROM expenses
     WHERE user_id = $1 AND billing_month = $2 AND COALESCE(type, 'expense') = 'income'`,
    [userId, yearMonth],
  );
  const incomeTotal = Number(incomeResult.rows[0]?.total ?? 0);

  // 예정 지출 합계
  const plannedRows = await queryPlannedExpenses(userId, yearMonth);
  const plannedTotal = plannedRows.reduce((s, p) => s + p.amount, 0);

  // 결제주기 일수 계산 (전월 16일 ~ 당월 15일)
  const daysInCycle = calcCycleDays(from, to);
  const dailyAvg = variableTotal > 0 ? Math.round(variableTotal / daysInCycle) : 0;

  // 자동 예산은 런웨이 API에서 따로 로드 (순환 참조 방지)
  // 기본값 null, 필요 시 클라이언트에서 병렬 로드
  return {
    year_month: yearMonth,
    total,
    budget: null,
    fixed_total: fixedTotal,
    variable_total: variableTotal,
    installment_total: installmentTotal,
    flexible_spent: flexibleSpent,
    income_total: incomeTotal,
    planned_total: plannedTotal,
    auto_budget: null,
    auto_daily: null,
    month_budget_remaining: null,
    today_budget: null,
    today_recommended: null,
    today_flex_spent: null,
    today_remaining: null,
    by_category: byCategory,
    daily_avg: dailyAvg,
  };
}

// ─── 고정비 ───────────────────────────────────────────

/** 고정비 수정 */
const FIXED_COST_COLUMNS = new Set([
  'name',
  'amount',
  'category',
  'is_variable',
  'day_of_month',
  'active',
  'memo',
  'payment_method',
]);

export async function updateFixedCost(
  userId: number,
  id: number,
  updates: Record<string, unknown>,
): Promise<FixedCostRow | null> {
  const keys = Object.keys(updates).filter((k) => FIXED_COST_COLUMNS.has(k));
  if (keys.length === 0) return null;

  const setClauses = keys.map((k, i) => `${k} = $${i + 3}`);
  const values = keys.map((k) => updates[k]);
  return queryOne<FixedCostRow>(
    `UPDATE fixed_costs SET ${setClauses.join(', ')}
     WHERE id = $1 AND user_id = $2
     RETURNING id, name, amount, category, is_variable, day_of_month, active, memo, payment_method`,
    [id, userId, ...values],
  );
}

/** 고정비 생성 */
export async function createFixedCost(
  userId: number,
  data: {
    name: string;
    amount: number;
    category?: string;
    day_of_month?: number | null;
    payment_method?: string | null;
  },
): Promise<FixedCostRow> {
  const row = await queryOne<FixedCostRow>(
    `INSERT INTO fixed_costs (user_id, name, amount, category, day_of_month, payment_method)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, amount, category, is_variable, day_of_month, active, memo, payment_method`,
    [
      userId,
      data.name,
      data.amount,
      data.category ?? null,
      data.day_of_month ?? null,
      data.payment_method ?? null,
    ],
  );
  if (!row) throw new Error('createFixedCost: INSERT returned no rows');
  return row;
}

/** 고정비 삭제 */
export async function deleteFixedCost(userId: number, id: number): Promise<boolean> {
  const result = await query(`DELETE FROM fixed_costs WHERE id = $1 AND user_id = $2`, [
    id,
    userId,
  ]);
  return (result.rowCount ?? 0) > 0;
}

// ─── 자산 ─────────────────────────────────────────────

/** 자산 목록 */
export async function queryAssets(userId: number): Promise<AssetRow[]> {
  const { rows } = await query<AssetRow>(
    `SELECT id, name, balance, type, available_amount, is_emergency,
            COALESCE(is_default, false) as is_default, memo, updated_at::text, balance_as_of::text
     FROM assets WHERE user_id = $1
     ORDER BY is_emergency ASC, is_default DESC, type, name`,
    [userId],
  );
  return rows;
}

/** 자산 잔액 수정 */
export async function updateAsset(
  userId: number,
  id: number,
  data: {
    balance?: number;
    available_amount?: number;
    memo?: string | null;
    /** 이 잔액이 며칠까지의 입출금을 반영한 값인가 (#615) */
    balance_as_of?: string;
  },
): Promise<AssetRow | null> {
  return queryOne<AssetRow>(
    `UPDATE assets
     SET balance = COALESCE($3, balance),
         available_amount = COALESCE($4, available_amount),
         memo = COALESCE($5, memo),
         balance_as_of = COALESCE($6::date, balance_as_of),
         updated_at = NOW()
     WHERE id = $1 AND user_id = $2
     RETURNING id, name, balance, type, available_amount, is_emergency,
               COALESCE(is_default, false) as is_default, memo, updated_at::text, balance_as_of::text`,
    [
      id,
      userId,
      data.balance ?? null,
      data.available_amount ?? null,
      data.memo ?? null,
      data.balance_as_of ?? null,
    ],
  );
}

/**
 * 기본 자산 지정 — user당 1개만 true.
 * 비상금(is_emergency=true) 자산은 default로 지정 불가.
 * 기존 default가 있으면 해제 후 신규 지정 (partial unique index 충돌 방지).
 */
export async function setDefaultAsset(userId: number, id: number): Promise<AssetRow | null> {
  const target = await queryOne<{ is_emergency: boolean }>(
    `SELECT is_emergency FROM assets WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  if (!target) return null;
  if (target.is_emergency) {
    throw new Error('EMERGENCY_ASSET_CANNOT_BE_DEFAULT');
  }
  await query(`UPDATE assets SET is_default = false WHERE user_id = $1 AND is_default = true`, [
    userId,
  ]);
  return queryOne<AssetRow>(
    `UPDATE assets SET is_default = true, updated_at = NOW()
     WHERE id = $1 AND user_id = $2
     RETURNING id, name, balance, type, available_amount, is_emergency,
               COALESCE(is_default, false) as is_default, memo, updated_at::text, balance_as_of::text`,
    [id, userId],
  );
}

/** 기본 자산 해제 */
export async function clearDefaultAsset(userId: number, id: number): Promise<AssetRow | null> {
  return queryOne<AssetRow>(
    `UPDATE assets SET is_default = false, updated_at = NOW()
     WHERE id = $1 AND user_id = $2
     RETURNING id, name, balance, type, available_amount, is_emergency,
               COALESCE(is_default, false) as is_default, memo, updated_at::text, balance_as_of::text`,
    [id, userId],
  );
}

// ─── 예정 지출 ────────────────────────────────────────

/** 예정 지출 목록 조회 (사용 금액 포함) */
export async function queryPlannedExpenses(
  userId: number,
  yearMonth?: string,
): Promise<PlannedExpenseRow[]> {
  const condition = yearMonth ? 'AND p.year_month = $2' : '';
  const params: unknown[] = yearMonth ? [userId, yearMonth] : [userId];
  const { rows } = await query<PlannedExpenseRow>(
    `SELECT p.id, p.year_month, p.amount, p.memo, p.created_at::text,
            COALESCE(SUM(e.amount), 0)::integer as used_amount
     FROM planned_expenses p
     LEFT JOIN expenses e ON e.planned_expense_id = p.id
     WHERE p.user_id = $1 ${condition}
     GROUP BY p.id
     ORDER BY p.year_month, p.created_at`,
    params,
  );
  return rows;
}

/** 예정 지출 추가 */
export async function createPlannedExpense(
  userId: number,
  data: { year_month: string; amount: number; memo?: string | null },
): Promise<PlannedExpenseRow> {
  const row = await queryOne<PlannedExpenseRow>(
    `INSERT INTO planned_expenses (user_id, year_month, amount, memo)
     VALUES ($1, $2, $3, $4)
     RETURNING id, year_month, amount, memo, created_at::text`,
    [userId, data.year_month, data.amount, data.memo ?? null],
  );
  if (!row) throw new Error('createPlannedExpense: INSERT returned no rows');
  return row;
}

/** 예정 지출 수정 */
export async function updatePlannedExpense(
  userId: number,
  id: number,
  data: { amount?: number; memo?: string | null },
): Promise<PlannedExpenseRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [id, userId];
  if (data.amount !== undefined) {
    sets.push(`amount = $${values.length + 1}`);
    values.push(data.amount);
  }
  if (data.memo !== undefined) {
    sets.push(`memo = $${values.length + 1}`);
    values.push(data.memo);
  }
  if (sets.length === 0) return null;
  return queryOne<PlannedExpenseRow>(
    `UPDATE planned_expenses SET ${sets.join(', ')}
     WHERE id = $1 AND user_id = $2
     RETURNING id, year_month, amount, memo, created_at::text`,
    values,
  );
}

/** 예정 지출 삭제 */
export async function deletePlannedExpense(userId: number, id: number): Promise<boolean> {
  const result = await query('DELETE FROM planned_expenses WHERE id = $1 AND user_id = $2', [
    id,
    userId,
  ]);
  return (result.rowCount ?? 0) > 0;
}

// ─── 일별 예산 로그 ──────────────────────────────────────

export type { DailyBudgetLog };

export interface DailyBudgetLogSummary {
  logs: DailyBudgetLog[];
  total_saved: number; // 해당 월 누적 세이브 (음수 = 누적 초과)
  days_logged: number; // 기록된 일수
  avg_daily_saved: number; // 일평균 세이브
}

/**
 * 일별 예산 스냅샷 저장 (Vercel cron에서 호출 — 전일 데이터)
 *
 * @param userId
 * @param opts.targetDate 스냅샷 대상 날짜 (생략 시 KST 오늘).
 *   Cron 핸들러는 `resolvePreviousDayDate(new Date())` 로 전일 날짜를 넘긴다.
 */
export async function saveDailyBudgetLog(
  userId: number,
  opts?: { targetDate?: string },
): Promise<{ date: string; budget: number; spent: number; saved: number }> {
  const targetDate = opts?.targetDate ?? getTodayISO();
  // T12:00:00Z = KST 21:00 → 당일 날짜 유지 (드리프트 보정은 호출 측에서 처리)
  const now = new Date(`${targetDate}T12:00:00Z`);

  // 일별 로그는 기준 일 예산(todayBudget) 기준으로 평가 — 사이클 시작 시 약속된
  // anchor 대비 그날 얼마나 잘 지켰는지가 누적 분석(세이브 합계, 일평균, 런웨이 환산)과 정합.
  const daily = await getTodayAllocation(userId, now);
  const budget = daily.todayBudget;
  const billingMonth = getCurrentBillingMonth(now);

  // targetDate의 자유 지출은 readTodayFlexSpent 단일 정의 사용 (SSOT)
  const spent = await readTodayFlexSpent(userId, targetDate, billingMonth);

  const saved = budget - spent;

  // UPSERT: 같은 날 다시 실행해도 최신 값으로 갱신
  await query(
    `INSERT INTO daily_budget_logs (user_id, date, billing_month, budget, spent, saved)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, date)
     DO UPDATE SET budget = $4, spent = $5, saved = $6, billing_month = $3`,
    [userId, targetDate, billingMonth, budget, spent, saved],
  );

  return { date: targetDate, budget, spent, saved };
}

/** billing_month 기준 일별 예산 로그 조회 */
export async function queryDailyBudgetLogs(
  userId: number,
  billingMonth: string,
): Promise<DailyBudgetLogSummary> {
  const { rows } = await query<DailyBudgetLog>(
    `SELECT date::text, billing_month, budget, spent, saved
     FROM daily_budget_logs
     WHERE user_id = $1 AND billing_month = $2
     ORDER BY date DESC`,
    [userId, billingMonth],
  );

  const totalSaved = rows.reduce((s, r) => s + r.saved, 0);
  const daysLogged = rows.length;

  return {
    logs: rows,
    total_saved: totalSaved,
    days_logged: daysLogged,
    avg_daily_saved: daysLogged > 0 ? Math.round(totalSaved / daysLogged) : 0,
  };
}
