import { query, queryOne } from '@/lib/db';
import { getTodayISO } from '@/lib/kst';
import { getTodayAllocation } from './facade';
import { getCurrentBillingMonth, getBillingRange, calcCycleDays } from './billing/cycle';
import { resolveFixedCostExpenseDate } from './billing/fixed-cost-date';
import { getBillingMonthForExpense } from './billing/card-billing';
import { readFlexibleSpent, readTodayFlexSpent } from './repository/expenses-repo';
import type {
  ExpenseRow,
  FixedCostRow,
  AssetRow,
  MonthSummary,
  CategoryStat,
  PlannedExpenseRow,
  DailyBudgetLog,
} from './types';

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
  const billingMonth = getBillingMonthForExpense(data.date, data.payment_method ?? '현대카드');
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
      data.payment_method ?? '현대카드',
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
    exclude_from_budget?: boolean;
  },
): Promise<ExpenseRow> {
  const monthlyAmount = Math.round(data.totalAmount / data.months);
  // 끝전 보정: 마지막 회차에서 나머지 흡수
  const lastMonthAmount = data.totalAmount - monthlyAmount * (data.months - 1);
  const groupId = crypto.randomUUID();
  const excludeFromBudget = data.exclude_from_budget ?? false;

  let firstRow: ExpenseRow | null = null;

  for (let i = 0; i < data.months; i++) {
    const amount = i === data.months - 1 ? lastMonthAmount : monthlyAmount;

    // 첫 회차 날짜 기준 i개월 후 계산
    const baseDate = new Date(`${data.date}T00:00:00`);
    baseDate.setMonth(baseDate.getMonth() + i);
    const expDate = `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}-${String(baseDate.getDate()).padStart(2, '0')}`;
    const billingMonth = getBillingMonthForExpense(expDate, data.payment_method ?? '현대카드');

    const row = await queryOne<ExpenseRow>(
      `INSERT INTO expenses (user_id, date, amount, category, description, payment_method,
                             is_installment, installment_num, installment_total, installment_group,
                             memo, source, type, exclude_from_budget, billing_month)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8, $9, $10, 'manual', $11, $12, $13)
       RETURNING id, date::text, amount, category, description, payment_method,
                 is_installment, installment_num, installment_total, installment_group,
                 source, memo, COALESCE(type, 'expense') as type, planned_expense_id, created_at::text,
                 COALESCE(exclude_from_budget, false) as exclude_from_budget`,
      [
        userId,
        expDate,
        amount,
        data.category,
        data.description ?? null,
        data.payment_method ?? '현대카드',
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

export async function updateExpense(
  userId: number,
  id: number,
  updates: Record<string, unknown>,
): Promise<ExpenseRow | null> {
  const keys = Object.keys(updates).filter((k) => EXPENSE_COLUMNS.has(k));
  if (keys.length === 0) return queryExpense(userId, id);

  // source='fixed' 행: 자유지출/고정비 이중 카운트 방지 — exclude_from_budget 변경 차단.
  // amount 등 다른 필드는 자유 수정 가능 (변동성 있는 고정비 케이스 지원).
  if (keys.includes('exclude_from_budget')) {
    const existing = await queryOne<{ source: string | null }>(
      `SELECT source FROM expenses WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    if (existing?.source === 'fixed') {
      throw new Error(FIXED_SOURCE_EXCLUDE_LOCKED);
    }
  }

  const setClauses = keys.map((k, i) => `${k} = $${i + 3}`);
  const values = keys.map((k) => updates[k]);
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

/** 지출 삭제 */
export async function deleteExpense(userId: number, id: number): Promise<boolean> {
  const result = await query('DELETE FROM expenses WHERE id = $1 AND user_id = $2', [id, userId]);
  return (result.rowCount ?? 0) > 0;
}

// ─── 월간 요약 ────────────────────────────────────────

/**
 * 월간 요약: 총 지출, 카테고리별, 예산 대비.
 * 카드 결제주기 기준: 전월 14일 ~ 당월 13일.
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

  // 자유 지출 합계 (exclude_from_budget=false인 것만)
  const variableResult = await queryOne<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0) as total FROM expenses
     WHERE user_id = $1 AND billing_month = $2
       AND exclude_from_budget = false
       AND COALESCE(type, 'expense') = 'expense'`,
    [userId, yearMonth],
  );
  const variableTotal = Number(variableResult?.total ?? 0);

  // 할부 합계 (예산 포함인 것 중 is_installment=true)
  const installmentResult = await query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0) as total FROM expenses
     WHERE user_id = $1 AND billing_month = $2
       AND is_installment = true
       AND exclude_from_budget = false
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

  // 결제주기 일수 계산 (전월 14일 ~ 당월 13일)
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

/** 고정비 목록 (active 먼저) */
export async function queryFixedCosts(userId: number): Promise<FixedCostRow[]> {
  const { rows } = await query<FixedCostRow>(
    `SELECT id, name, amount, category, is_variable, day_of_month, active, memo
     FROM fixed_costs WHERE user_id = $1 ORDER BY active DESC, category, name`,
    [userId],
  );
  return rows;
}

/** 고정비 수정 */
const FIXED_COST_COLUMNS = new Set([
  'name',
  'amount',
  'category',
  'is_variable',
  'day_of_month',
  'active',
  'memo',
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
     RETURNING id, name, amount, category, is_variable, day_of_month, active, memo`,
    [id, userId, ...values],
  );
}

/** 고정비 생성 */
export async function createFixedCost(
  userId: number,
  data: { name: string; amount: number; category?: string; day_of_month?: number | null },
): Promise<FixedCostRow> {
  const row = await queryOne<FixedCostRow>(
    `INSERT INTO fixed_costs (user_id, name, amount, category, day_of_month)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, amount, category, is_variable, day_of_month, active, memo`,
    [userId, data.name, data.amount, data.category ?? null, data.day_of_month ?? null],
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

/**
 * 고정비 자동 기록: 결제일(day_of_month)이 설정된 활성 고정비에 대해
 * 해당 결제주기 내에 지출 기록이 없으면 자동 생성.
 */
export async function ensureFixedCostExpenses(userId: number, yearMonth: string): Promise<number> {
  const fixedCosts = await queryFixedCosts(userId);
  const activeCostsWithDay = fixedCosts.filter((fc) => fc.active && fc.day_of_month);

  if (activeCostsWithDay.length === 0) return 0;

  const todayStr = getTodayISO();

  const candidates = activeCostsWithDay
    .map((fc) => {
      const expenseDate = resolveFixedCostExpenseDate(yearMonth, fc.day_of_month!);
      return { fc, expenseDate };
    })
    .filter((c) => c.expenseDate <= todayStr)
    .map((c) => ({
      ...c,
      billingMonth: getBillingMonthForExpense(c.expenseDate, '현대카드'),
    }));

  if (candidates.length === 0) return 0;

  const result = await query(
    `INSERT INTO expenses
       (user_id, date, amount, category, description, payment_method, source, memo, type, exclude_from_budget, billing_month)
     SELECT $1, d.date, d.amount, d.category, d.description, '현대카드', 'fixed', d.memo, 'expense', true, d.billing_month
     FROM UNNEST(
       $2::date[], $3::numeric[], $4::text[], $5::text[], $6::text[], $7::text[]
     ) AS d(date, amount, category, description, memo, billing_month)
     WHERE NOT EXISTS (
       SELECT 1 FROM expenses e
       WHERE e.user_id = $1 AND e.source = 'fixed' AND e.date = d.date AND e.description = d.description
     )`,
    [
      userId,
      candidates.map((c) => c.expenseDate),
      candidates.map((c) => c.fc.amount),
      candidates.map((c) => c.fc.category ?? '기타'),
      candidates.map((c) => c.fc.name),
      candidates.map((c) => `고정비 자동 기록 (fixed_cost_id: ${c.fc.id})`),
      candidates.map((c) => c.billingMonth),
    ],
  );

  return result.rowCount ?? 0;
}

// ─── 자산 ─────────────────────────────────────────────

/** 자산 목록 */
export async function queryAssets(userId: number): Promise<AssetRow[]> {
  const { rows } = await query<AssetRow>(
    `SELECT id, name, balance, type, available_amount, is_emergency, memo, updated_at::text
     FROM assets WHERE user_id = $1 ORDER BY is_emergency ASC, type, name`,
    [userId],
  );
  return rows;
}

/** 자산 잔액 수정 */
export async function updateAsset(
  userId: number,
  id: number,
  data: { balance?: number; available_amount?: number; memo?: string | null },
): Promise<AssetRow | null> {
  return queryOne<AssetRow>(
    `UPDATE assets
     SET balance = COALESCE($3, balance),
         available_amount = COALESCE($4, available_amount),
         memo = COALESCE($5, memo),
         updated_at = NOW()
     WHERE id = $1 AND user_id = $2
     RETURNING id, name, balance, type, available_amount, is_emergency, memo, updated_at::text`,
    [id, userId, data.balance ?? null, data.available_amount ?? null, data.memo ?? null],
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

// ─── 가용자금 실시간 계산 ────────────────────────────────

interface EffectiveAvailable {
  snapshot_total: number; // 자산 스냅샷 합계
  expense_since: number; // 스냅샷 이후 지출
  income_since: number; // 스냅샷 이후 수입
  effective: number; // 실시간 가용자금
  latest_update: string | null;
}

/**
 * 가용자금 실시간 계산 (단일 CTE 쿼리로 통합):
 * 자산 available_amount 합계 - 스냅샷 이후 지출 + 스냅샷 이후 수입
 */
export async function getEffectiveAvailable(userId: number): Promise<EffectiveAvailable> {
  const result = await queryOne<{
    snapshot_total: string;
    latest_update: string | null;
    expense_since: string;
    income_since: string;
  }>(
    `WITH asset_snapshot AS (
       SELECT COALESCE(SUM(available_amount), 0) as total, MAX(updated_at) as latest
       FROM assets WHERE user_id = $1 AND is_emergency = false
     )
     SELECT
       a.total::text as snapshot_total,
       a.latest::text as latest_update,
       COALESCE((SELECT SUM(amount) FROM expenses WHERE user_id = $1 AND COALESCE(type,'expense')='expense' AND created_at > a.latest), 0)::text as expense_since,
       COALESCE((SELECT SUM(amount) FROM expenses WHERE user_id = $1 AND COALESCE(type,'expense')='income' AND created_at > a.latest), 0)::text as income_since
     FROM asset_snapshot a`,
    [userId],
  );

  const snapshotTotal = Number(result?.snapshot_total ?? 0);
  const expenseSince = Number(result?.expense_since ?? 0);
  const incomeSince = Number(result?.income_since ?? 0);

  return {
    snapshot_total: snapshotTotal,
    expense_since: expenseSince,
    income_since: incomeSince,
    effective: snapshotTotal - expenseSince + incomeSince,
    latest_update: result?.latest_update ?? null,
  };
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
