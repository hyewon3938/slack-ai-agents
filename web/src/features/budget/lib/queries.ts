import { query, queryOne } from '@/lib/db';
import { getTodayISO } from '@/lib/kst';
import {
  addBillingMonths,
  getCurrentBillingMonth,
  getBillingRange,
  calcCycleDays,
  calculateBudgetAllocation,
} from './budget-calc';
import type { InstallmentProjection } from './budget-calc';
import type {
  ExpenseRow,
  FixedCostRow,
  BudgetRow,
  AssetRow,
  MonthSummary,
  CategoryStat,
  MonthProjection,
  PlannedExpenseRow,
} from './types';

// ─── 지출 CRUD ───────────────────────────────────────

/** 기간별 지출 조회 (최신순) */
export async function queryExpenses(
  userId: number,
  from: string,
  to: string,
  category?: string,
): Promise<ExpenseRow[]> {
  const conditions = ['user_id = $1', 'date >= $2', 'date <= $3'];
  const params: unknown[] = [userId, from, to];
  if (category) {
    conditions.push(`category = $${params.length + 1}`);
    params.push(category);
  }
  const { rows } = await query<ExpenseRow>(
    `SELECT id, date::text, amount, category, description, payment_method,
            is_installment, installment_num, installment_total, installment_group,
            source, memo, COALESCE(type, 'expense') as type, planned_expense_id, created_at::text,
            COALESCE(exclude_from_budget, false) as exclude_from_budget
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
            COALESCE(exclude_from_budget, false) as exclude_from_budget
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
  },
): Promise<ExpenseRow> {
  const row = await queryOne<ExpenseRow>(
    `INSERT INTO expenses (user_id, date, amount, category, description, payment_method, memo, source, type, planned_expense_id, exclude_from_budget)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'manual', $8, $9, $10)
     RETURNING id, date::text, amount, category, description, payment_method,
               is_installment, installment_num, installment_total, installment_group,
               source, memo, COALESCE(type, 'expense') as type, planned_expense_id, created_at::text,
               COALESCE(exclude_from_budget, false) as exclude_from_budget`,
    [
      userId,
      data.date,
      data.amount,
      data.category,
      data.description ?? null,
      data.payment_method ?? '카드',
      data.memo ?? null,
      data.type ?? 'expense',
      data.planned_expense_id ?? null,
      data.exclude_from_budget ?? false,
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

    const row = await queryOne<ExpenseRow>(
      `INSERT INTO expenses (user_id, date, amount, category, description, payment_method,
                             is_installment, installment_num, installment_total, installment_group,
                             memo, source, type, exclude_from_budget)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8, $9, $10, 'manual', $11, $12)
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
        data.payment_method ?? '카드',
        i + 1,
        data.months,
        groupId,
        data.memo ?? null,
        data.type ?? 'expense',
        excludeFromBudget,
      ],
    );
    if (i === 0) firstRow = row ?? null;
  }

  if (!firstRow) throw new Error('createInstallmentExpenses: INSERT returned no rows');
  return firstRow;
}

/** 지출 수정 (허용 컬럼 화이트리스트) */
const EXPENSE_COLUMNS = new Set(['date', 'amount', 'category', 'description', 'payment_method', 'memo', 'type', 'planned_expense_id', 'exclude_from_budget']);

export async function updateExpense(
  userId: number,
  id: number,
  updates: Record<string, unknown>,
): Promise<ExpenseRow | null> {
  const keys = Object.keys(updates).filter((k) => EXPENSE_COLUMNS.has(k));
  if (keys.length === 0) return queryExpense(userId, id);

  const setClauses = keys.map((k, i) => `${k} = $${i + 3}`);
  const values = keys.map((k) => updates[k]);
  return queryOne<ExpenseRow>(
    `UPDATE expenses SET ${setClauses.join(', ')}
     WHERE id = $1 AND user_id = $2
     RETURNING id, date::text, amount, category, description, payment_method,
               is_installment, installment_num, installment_total, installment_group,
               source, memo, COALESCE(type, 'expense') as type, planned_expense_id, created_at::text,
            COALESCE(exclude_from_budget, false) as exclude_from_budget`,
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
 * 카드 결제주기 기준: 전월 16일 ~ 당월 15일.
 */
export async function queryMonthSummary(userId: number, yearMonth: string): Promise<MonthSummary> {
  const [year, month] = yearMonth.split('-').map(Number);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const from = `${prevYear}-${String(prevMonth).padStart(2, '0')}-16`;
  const to = `${year}-${String(month).padStart(2, '0')}-15`;

  const [totalResult, categoryResult, budget, fixedCosts] = await Promise.all([
    query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0) as total FROM expenses
       WHERE user_id = $1 AND date >= $2 AND date <= $3 AND COALESCE(type, 'expense') = 'expense'`,
      [userId, from, to],
    ),
    query<{ category: string; total: string; count: string }>(
      `SELECT category, SUM(amount) as total, COUNT(*) as count
       FROM expenses WHERE user_id = $1 AND date >= $2 AND date <= $3
         AND COALESCE(type, 'expense') = 'expense'
       GROUP BY category ORDER BY SUM(amount) DESC`,
      [userId, from, to],
    ),
    queryBudget(userId, yearMonth),
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
     WHERE user_id = $1 AND date >= $2 AND date <= $3
       AND exclude_from_budget = false
       AND COALESCE(type, 'expense') = 'expense'`,
    [userId, from, to],
  );
  const variableTotal = Number(variableResult?.total ?? 0);

  // 할부 합계 (예산 포함인 것 중 is_installment=true)
  const installmentResult = await query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0) as total FROM expenses
     WHERE user_id = $1 AND date >= $2 AND date <= $3
       AND is_installment = true
       AND exclude_from_budget = false
       AND COALESCE(type, 'expense') = 'expense'`,
    [userId, from, to],
  );
  const installmentTotal = Number(installmentResult.rows[0]?.total ?? 0);

  // 예정 지출 연결 건: 예정 금액까지만 제외, 초과분은 자유 지출에 포함
  const plannedLinkedResult = await query<{ linked: string; overflow: string }>(
    `SELECT
       COALESCE(SUM(LEAST(used, budget)), 0) as linked,
       COALESCE(SUM(GREATEST(used - budget, 0)), 0) as overflow
     FROM (
       SELECT p.amount as budget, COALESCE(SUM(e.amount), 0) as used
       FROM planned_expenses p
       LEFT JOIN expenses e ON e.planned_expense_id = p.id
         AND e.date >= $2 AND e.date <= $3
       WHERE p.user_id = $1
       GROUP BY p.id, p.amount
     ) sub`,
    [userId, from, to],
  );
  const plannedLinkedTotal = Number(plannedLinkedResult.rows[0]?.linked ?? 0);
  const flexibleSpent = variableTotal - installmentTotal - plannedLinkedTotal;

  // 수입 합계 (type='income')
  const incomeResult = await query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0) as total FROM expenses
     WHERE user_id = $1 AND date >= $2 AND date <= $3 AND COALESCE(type, 'expense') = 'income'`,
    [userId, from, to],
  );
  const incomeTotal = Number(incomeResult.rows[0]?.total ?? 0);

  // 예정 지출 합계
  const plannedRows = await queryPlannedExpenses(userId, yearMonth);
  const plannedTotal = plannedRows.reduce((s, p) => s + p.amount, 0);

  // 결제주기 일수 계산 (전월 16일 ~ 당월 15일)
  const fromDate = new Date(`${from}T00:00:00`);
  const toDate = new Date(`${to}T00:00:00`);
  const daysInCycle = Math.round((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const dailyAvg = variableTotal > 0 ? Math.round(variableTotal / daysInCycle) : 0;

  // 자동 예산은 런웨이 API에서 따로 로드 (순환 참조 방지)
  // 기본값 null, 필요 시 클라이언트에서 병렬 로드
  return {
    year_month: yearMonth,
    total,
    budget,
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
const FIXED_COST_COLUMNS = new Set(['name', 'amount', 'category', 'is_variable', 'day_of_month', 'active', 'memo']);

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
  const result = await query(
    `DELETE FROM fixed_costs WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * 고정비 자동 기록: 결제일(day_of_month)이 설정된 활성 고정비에 대해
 * 해당 결제주기 내에 지출 기록이 없으면 자동 생성.
 */
export async function ensureFixedCostExpenses(userId: number, yearMonth: string): Promise<number> {
  const [year, month] = yearMonth.split('-').map(Number);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;

  const fixedCosts = await queryFixedCosts(userId);
  const activeCostsWithDay = fixedCosts.filter((fc) => fc.active && fc.day_of_month);

  if (activeCostsWithDay.length === 0) return 0;

  const todayStr = getTodayISO();

  let created = 0;

  for (const fc of activeCostsWithDay) {
    const day = fc.day_of_month!;

    let expenseYear: number, expenseMonth: number;
    if (day >= 16) {
      expenseYear = prevYear;
      expenseMonth = prevMonth;
    } else {
      expenseYear = year;
      expenseMonth = month;
    }

    const lastDay = new Date(expenseYear, expenseMonth, 0).getDate();
    const actualDay = Math.min(day, lastDay);
    const expenseDate = `${expenseYear}-${String(expenseMonth).padStart(2, '0')}-${String(actualDay).padStart(2, '0')}`;

    if (expenseDate > todayStr) continue;

    const existing = await queryOne<{ id: number }>(
      `SELECT id FROM expenses
       WHERE user_id = $1 AND source = 'fixed' AND date = $2 AND description = $3`,
      [userId, expenseDate, fc.name],
    );

    if (existing) continue;

    await queryOne(
      `INSERT INTO expenses (user_id, date, amount, category, description, payment_method, source, memo, type, exclude_from_budget)
       VALUES ($1, $2, $3, $4, $5, '카드', 'fixed', $6, 'expense', true)
       RETURNING id`,
      [userId, expenseDate, fc.amount, fc.category ?? '기타', fc.name, `고정비 자동 기록 (fixed_cost_id: ${fc.id})`],
    );
    created++;
  }

  return created;
}

// ─── 예산 ─────────────────────────────────────────────

/** 월 예산 조회 */
export async function queryBudget(userId: number, yearMonth: string): Promise<BudgetRow | null> {
  return queryOne<BudgetRow>(
    `SELECT id, year_month, total_budget, daily_budget, notes
     FROM budgets WHERE user_id = $1 AND year_month = $2`,
    [userId, yearMonth],
  );
}

/** 예산 설정/수정 (upsert) */
export async function upsertBudget(
  userId: number,
  yearMonth: string,
  data: { total_budget?: number | null; daily_budget?: number | null; notes?: string | null },
): Promise<BudgetRow> {
  const row = await queryOne<BudgetRow>(
    `INSERT INTO budgets (user_id, year_month, total_budget, daily_budget, notes)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, year_month) DO UPDATE
     SET total_budget = EXCLUDED.total_budget,
         daily_budget = EXCLUDED.daily_budget,
         notes = EXCLUDED.notes
     RETURNING id, year_month, total_budget, daily_budget, notes`,
    [userId, yearMonth, data.total_budget ?? null, data.daily_budget ?? null, data.notes ?? null],
  );
  if (!row) throw new Error('upsertBudget: UPSERT returned no rows');
  return row;
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
export async function queryPlannedExpenses(userId: number, yearMonth?: string): Promise<PlannedExpenseRow[]> {
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

/** 예정 지출 삭제 */
export async function deletePlannedExpense(userId: number, id: number): Promise<boolean> {
  const result = await query(
    'DELETE FROM planned_expenses WHERE id = $1 AND user_id = $2',
    [id, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

// ─── 예산 설정 (목표 기간 등) ─────────────────────────────

/** 목표 기간 조회 */
export async function queryTargetDate(userId: number): Promise<string | null> {
  const row = await queryOne<{ target_date: string | null }>(
    'SELECT target_date FROM budget_settings WHERE user_id = $1',
    [userId],
  );
  return row?.target_date ?? null;
}

/** 목표 기간 저장 */
export async function upsertTargetDate(userId: number, targetDate: string | null): Promise<void> {
  await query(
    `INSERT INTO budget_settings (user_id, target_date, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE SET target_date = $2, updated_at = NOW()`,
    [userId, targetDate],
  );
}

// ─── 가용자금 실시간 계산 ────────────────────────────────

interface EffectiveAvailable {
  snapshot_total: number;  // 자산 스냅샷 합계
  expense_since: number;   // 스냅샷 이후 지출
  income_since: number;    // 스냅샷 이후 수입
  effective: number;       // 실시간 가용자금
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

// ─── 런웨이 계산 (월별 시뮬레이션) ──────────────────────

/** 월별 예산 프리뷰 (설정 탭용) */
export interface MonthBudgetPreview {
  month: string;
  locked: number;         // 고정비 + 할부 + 예정지출
  installments: number;   // 할부 합계
  planned: number;        // 예정 지출 합계
  free: number;           // 자유 예산
  daily: number;          // 일일 자유 예산
}

export interface RunwayResult {
  // 가용자금
  effective_available: number;   // 실시간 가용자금
  snapshot_total: number;        // 자산 스냅샷 합계
  fixed_monthly: number;         // 월 고정비

  // 목표 기반 예산
  target_date: string | null;
  free_per_month: number | null; // 균등 분배 월 자유 예산

  // 동적 일일 예산
  dynamic_daily: number;         // (월예산 - 이번달지출) / 남은일수
  month_budget_remaining: number; // 이번 달 남은 자유 예산
  cycle_days: number;
  cycle_remaining_days: number;  // 남은 일수
  cycle_elapsed: number;         // 경과 일수
  flexible_spent: number;        // 이번 주기 자유 지출
  current_month_income: number;  // 이번 달 수입

  // 실제 런웨이 (시뮬레이션)
  actual_runway_months: number;
  actual_runway_date: string;
  projections: MonthProjection[];

  // 남은 총 일수 (현재 주기 잔여 + 미래 월)
  total_remaining_days: number;

  // 평균 가변 지출 (참고용)
  avg_variable_monthly: number;

  // 오늘의 현황 (하루 고정)
  today_budget: number;       // 오늘 할당 예산 (B방식 — 하루 고정)
  today_flex_spent: number;   // 오늘 자유 지출
  today_remaining: number;    // 오늘 남음(양수)/초과(음수)
}

/**
 * 목표 날짜 기준 월별 예산 프리뷰 계산
 * 설정 탭에서 목표 날짜 변경 시 즉시 확인용
 */
export async function calcBudgetPreview(
  userId: number,
  targetDate: string,
): Promise<{ free_per_month: number; daily_estimate: number; month_breakdown: MonthBudgetPreview[] } | null> {
  if (!/^\d{4}-\d{2}$/.test(targetDate)) return null;

  const calcNow = new Date(`${getTodayISO()}T12:00:00`);
  const billingMonth = getCurrentBillingMonth(calcNow);
  const [ty, tm] = targetDate.split('-').map(Number);
  const [by, bm] = billingMonth.split('-').map(Number);
  // +1: "8월까지" = 8월 대금(7/16~8/15) 포함
  const targetMonths = (ty - by) * 12 + (tm - bm) + 1;
  if (targetMonths <= 0) return null;

  const [effectiveData, fixedCosts, installmentRows, allPlanned, budgetStartRowPreview] = await Promise.all([
    getEffectiveAvailable(userId),
    queryFixedCosts(userId),
    query<{ installment_group: string; installment_num: number; installment_total: number; amount: number; group_created_at: string }>(
      `SELECT DISTINCT ON (installment_group)
         installment_group, installment_num, installment_total, amount,
         (SELECT MIN(created_at) FROM expenses e2 WHERE e2.installment_group = e.installment_group)::text as group_created_at
       FROM expenses e
       WHERE user_id = $1 AND is_installment = true AND installment_group IS NOT NULL
       ORDER BY installment_group, date DESC, created_at DESC`,
      [userId],
    ),
    queryPlannedExpenses(userId),
    queryOne<{ updated_at: string }>('SELECT updated_at::text FROM budget_settings WHERE user_id = $1', [userId]),
  ]);

  // ─── 런웨이와 동일한 budgetBase 계산 ───
  // flexibleSpent를 더해서 "이번 달 시작 시점" 가용자금으로 복원하고,
  // currentMonthIncome을 빼서 수입은 이번 달에만 반영 (미래 달 예산 부풀림 방지)
  const fixedMonthly = fixedCosts.filter((fc) => fc.active).reduce((s, fc) => s + fc.amount, 0);
  const previewBudgetStartAt = budgetStartRowPreview?.updated_at ?? null;

  // 지출 추적 범위 (런웨이와 동일)
  const { from: cycleFrom, to: cycleTo } = getBillingRange(billingMonth);
  const cycleDays = calcCycleDays(cycleFrom, cycleTo);
  const todayISOStr = getTodayISO();
  const budgetStartStr = previewBudgetStartAt ? previewBudgetStartAt.slice(0, 10) : cycleFrom;
  const trackingFrom = budgetStartStr > cycleFrom ? budgetStartStr : cycleFrom;
  const trackingFromDate = new Date(`${trackingFrom}T00:00:00`);
  const cycleToDate = new Date(`${cycleTo}T00:00:00`);
  const budgetDays = Math.max(1, Math.round((cycleToDate.getTime() - trackingFromDate.getTime()) / 86400000) + 1);

  // 이번 달 자유 지출 + 수입 조회
  const endDate = todayISOStr < cycleTo ? todayISOStr : cycleTo;
  const budgetStartAtParam = previewBudgetStartAt ?? '9999-12-31T00:00:00Z';
  const cycleMetrics = await queryOne<{ flex: string; overflow: string; income: string }>(
    `SELECT
       COALESCE((SELECT SUM(amount) FROM expenses
         WHERE user_id=$1 AND date>=$2 AND date<=$3
           AND (is_installment=false OR (is_installment=true AND created_at>=$6))
           AND exclude_from_budget = false
           AND COALESCE(type,'expense')='expense' AND planned_expense_id IS NULL
       ), 0)::text as flex,
       COALESCE((SELECT SUM(GREATEST(used-budget,0)) FROM (
         SELECT p.amount as budget, COALESCE(SUM(e.amount),0) as used
         FROM planned_expenses p LEFT JOIN expenses e ON e.planned_expense_id=p.id AND e.date>=$2 AND e.date<=$3
         WHERE p.user_id=$1 GROUP BY p.id, p.amount
       ) sub), 0)::text as overflow,
       COALESCE((SELECT SUM(amount) FROM expenses
         WHERE user_id=$1 AND date>=$4 AND date<=$5 AND COALESCE(type,'expense')='income'
       ), 0)::text as income`,
    [userId, trackingFrom, endDate, cycleFrom, cycleTo, budgetStartAtParam],
  );
  const flexibleSpent = Number(cycleMetrics?.flex ?? 0) + Number(cycleMetrics?.overflow ?? 0);
  const currentMonthIncome = Number(cycleMetrics?.income ?? 0);

  const installments: InstallmentProjection[] = installmentRows.rows
    .filter((r) => r.installment_total > r.installment_num)
    .map((r) => ({
      amount: r.amount,
      remaining: r.installment_total - r.installment_num,
      isNew: previewBudgetStartAt !== null && r.group_created_at >= previewBudgetStartAt,
    }));

  // 공통 예산 배분 계산
  const calcResult = calculateBudgetAllocation({
    totalAvailable: effectiveData.effective,
    fixedMonthly,
    installments,
    plannedExpenses: allPlanned.map((p) => ({ year_month: p.year_month, amount: p.amount })),
    billingMonth,
    targetDate,
    budgetDays,
    cycleDays,
    flexibleSpent,
    currentMonthIncome,
  });

  if (calcResult.freePerMonth === null) return null;

  const { freePerMonth, dailyFree, monthlyLocked } = calcResult;
  const dailyEstimate = Math.round(dailyFree);

  // 월별 브레이크다운
  const monthBreakdown: MonthBudgetPreview[] = monthlyLocked.map((ml) => {
    const { from: bFrom, to: bTo } = getBillingRange(ml.month);
    const fullCycleDays = calcCycleDays(bFrom, bTo);
    return {
      month: ml.month,
      locked: ml.total,
      installments: ml.installments,
      planned: ml.planned,
      free: Math.round(dailyFree * ml.days),
      daily: fullCycleDays > 0 ? Math.round(freePerMonth / fullCycleDays) : dailyEstimate,
    };
  });

  return { free_per_month: freePerMonth, daily_estimate: dailyEstimate, month_breakdown: monthBreakdown };
}

export async function queryRunway(userId: number, targetDate?: string): Promise<RunwayResult> {
  const todayStr = getTodayISO();
  const now = new Date(`${todayStr}T12:00:00`);
  const billingMonth = getCurrentBillingMonth(now);

  // 예산 시작일: 목표 기간을 처음 설정한 날 (이전 지출은 과거 취급)
  const budgetStartRow = await queryOne<{ updated_at: string }>(
    'SELECT updated_at::text FROM budget_settings WHERE user_id = $1',
    [userId],
  );

  const [effectiveData, fixedCosts, installmentRows, variableRows, allPlanned] = await Promise.all([
    getEffectiveAvailable(userId),
    queryFixedCosts(userId),
    query<{ installment_group: string; installment_num: number; installment_total: number; amount: number; group_created_at: string }>(
      `SELECT DISTINCT ON (installment_group)
         installment_group, installment_num, installment_total, amount,
         (SELECT MIN(created_at) FROM expenses e2 WHERE e2.installment_group = e.installment_group)::text as group_created_at
       FROM expenses e
       WHERE user_id = $1 AND is_installment = true AND installment_group IS NOT NULL
       ORDER BY installment_group, date DESC, created_at DESC`,
      [userId],
    ),
    // 최근 3개월 가변 지출 평균 (예산 포함 지출만)
    query<{ avg_monthly: string }>(
      `SELECT COALESCE(AVG(monthly_total), 0) as avg_monthly
       FROM (
         SELECT DATE_TRUNC('month', date) as month, SUM(amount) as monthly_total
         FROM expenses
         WHERE user_id = $1
           AND date >= NOW() - INTERVAL '3 months'
           AND exclude_from_budget = false
           AND COALESCE(type, 'expense') = 'expense'
         GROUP BY 1
       ) sub`,
      [userId],
    ),
    queryPlannedExpenses(userId),
  ]);

  const totalAvailable = effectiveData.effective;
  const fixedMonthly = fixedCosts.filter((fc) => fc.active).reduce((s, fc) => s + fc.amount, 0);
  const avgVariableMonthly = Math.round(Number(variableRows.rows[0]?.avg_monthly ?? 0));

  // 할부 프로젝션: 그룹별 남은 회차와 월 금액
  // isNew: 예산 시작일 이후 생성된 할부 → 결제일은 자유 지출, 미래 회차만 locked
  const budgetStartAt = budgetStartRow?.updated_at ?? null;
  const installments = installmentRows.rows
    .filter((r) => r.installment_total > r.installment_num)
    .map((r) => ({
      amount: r.amount,
      remaining: r.installment_total - r.installment_num,
      isNew: budgetStartAt !== null && r.group_created_at >= budgetStartAt,
    }));

  // ─── 목표 기간 기반 계산 ───
  const validTarget = targetDate && /^\d{4}-\d{2}$/.test(targetDate) ? targetDate : null;
  let freePerMonth: number | null = null;

  // ─── 현재 결제주기 추적 ───
  const { from: cycleFrom, to: cycleTo } = getBillingRange(billingMonth);
  const cycleDays = calcCycleDays(cycleFrom, cycleTo);

  const todayDate = new Date(`${todayStr}T00:00:00`);
  const cycleFromDate = new Date(`${cycleFrom}T00:00:00`);
  const cycleToDate = new Date(`${cycleTo}T00:00:00`);

  // 예산 시작일: 목표 기간 설정일. 이전 지출은 과거 취급
  const budgetStartStr = budgetStartRow?.updated_at
    ? budgetStartRow.updated_at.slice(0, 10)
    : cycleFrom;
  const budgetStartDate = new Date(`${budgetStartStr}T00:00:00`);

  // 지출 추적 시작일: max(주기시작, 예산시작)
  const trackingFrom = budgetStartDate > cycleFromDate ? budgetStartStr : cycleFrom;
  const trackingFromDate = new Date(`${trackingFrom}T00:00:00`);

  // 남은 일수: 추적 시작 ~ 주기 끝 기준
  const budgetDays = Math.max(1, Math.round((cycleToDate.getTime() - trackingFromDate.getTime()) / 86400000) + 1);
  const daysSinceStart = Math.max(0, Math.round((todayDate.getTime() - trackingFromDate.getTime()) / 86400000) + 1);
  const cycleElapsed = daysSinceStart;
  const cycleRemainingDays = Math.max(0, budgetDays - daysSinceStart);

  // 현재 주기 자유 지출 + 예정 초과 + 수입 + 오늘 자유 지출 (단일 쿼리로 통합)
  // 신규 할부(예산 시작일 이후 생성): 자유 지출에 포함 ($7: budgetStartAt)
  // budgetStartAt이 null이면 '9999-12-31T00:00:00Z'로 폴백 → 모든 할부가 구 할부로 처리됨
  const endDate = todayStr < cycleTo ? todayStr : cycleTo;
  const budgetStartAtParam = budgetStartAt ?? '9999-12-31T00:00:00Z';
  const cycleMetrics = await queryOne<{ flex: string; overflow: string; income: string; today_flex: string }>(
    `SELECT
       COALESCE((SELECT SUM(amount) FROM expenses
         WHERE user_id=$1 AND date>=$2 AND date<=$3
           AND (is_installment=false OR (is_installment=true AND created_at>=$7))
           AND exclude_from_budget = false
           AND COALESCE(type,'expense')='expense' AND planned_expense_id IS NULL
       ), 0)::text as flex,
       COALESCE((SELECT SUM(GREATEST(used-budget,0)) FROM (
         SELECT p.amount as budget, COALESCE(SUM(e.amount),0) as used
         FROM planned_expenses p LEFT JOIN expenses e ON e.planned_expense_id=p.id AND e.date>=$2 AND e.date<=$3
         WHERE p.user_id=$1 GROUP BY p.id, p.amount
       ) sub), 0)::text as overflow,
       COALESCE((SELECT SUM(amount) FROM expenses
         WHERE user_id=$1 AND date>=$4 AND date<=$5 AND COALESCE(type,'expense')='income'
       ), 0)::text as income,
       COALESCE((SELECT SUM(amount) FROM expenses
         WHERE user_id=$1 AND date=$6
           AND (is_installment=false OR (is_installment=true AND created_at>=$7))
           AND exclude_from_budget = false
           AND COALESCE(type,'expense')='expense' AND planned_expense_id IS NULL
       ), 0)::text as today_flex`,
    [userId, trackingFrom, endDate, cycleFrom, cycleTo, todayStr, budgetStartAtParam],
  );
  const flexibleSpent = Number(cycleMetrics?.flex ?? 0) + Number(cycleMetrics?.overflow ?? 0);
  const currentMonthIncome = Number(cycleMetrics?.income ?? 0);
  const todayFlexSpent = Number(cycleMetrics?.today_flex ?? 0);

  // ─── 예산 배분 계산 (공통 함수) ───
  // budgetBase 보정, 월별 locked, freePerMonth, dailyFree 산출
  const calcResult = calculateBudgetAllocation({
    totalAvailable,
    fixedMonthly,
    installments,
    plannedExpenses: allPlanned.map((p) => ({ year_month: p.year_month, amount: p.amount })),
    billingMonth,
    targetDate: validTarget,
    budgetDays,
    cycleDays,
    flexibleSpent,
    currentMonthIncome,
  });
  freePerMonth = calcResult.freePerMonth;

  // 시뮬레이션 자유 예산: 목표 기반 > 평균 순
  const simulationFreeBudget = freePerMonth ?? avgVariableMonthly;

  // ─── 동적 일일 예산 ───
  // 가용자금 기반 월 예산에서 예산 시작일 이후 자유 지출을 빼고 남은 일수로 나눔
  let dynamicDaily = 0;
  let monthBudgetRemaining = 0;
  // 미래 달 일수: monthlyLocked[1..].days 합계 (month 0 제외)
  let totalRemainingDays = cycleRemainingDays + calcResult.monthlyLocked.slice(1).reduce((s, ml) => s + ml.days, 0);

  if (validTarget && freePerMonth !== null) {
    // 이번 달 자유 예산: 남은 일수 비율로 프로레이션
    // (첫 달은 예산 시작일 이후 기간만 해당)
    const proratedBudget = Math.round(freePerMonth * budgetDays / cycleDays);
    const thisMonthFree = proratedBudget + currentMonthIncome;
    monthBudgetRemaining = thisMonthFree - flexibleSpent;
    dynamicDaily = cycleRemainingDays > 0
      ? Math.round(monthBudgetRemaining / cycleRemainingDays)
      : 0;
  } else {
    // 목표 미설정: 3개월 평균 기준
    monthBudgetRemaining = Math.max(0, avgVariableMonthly - flexibleSpent);
    dynamicDaily = cycleRemainingDays > 0
      ? Math.round(monthBudgetRemaining / cycleRemainingDays)
      : (cycleDays > 0 ? Math.round(avgVariableMonthly / cycleDays) : 0);
  }

  // 오늘 할당 예산 (B방식 — 하루 고정)
  // "오늘 시작 시점 남은 예산 / 오늘 포함 남은 일수" 로 역산
  // cycleRemainingDays는 오늘 제외 남은 일수이므로 +1하면 오늘 포함
  const budgetBeforeToday = monthBudgetRemaining + todayFlexSpent;
  const todayIncludedDays = cycleRemainingDays + 1;
  const todayBudget = todayIncludedDays > 0 ? Math.round(budgetBeforeToday / todayIncludedDays) : 0;
  const todayRemaining = todayBudget - todayFlexSpent;

  // ─── 월별 시뮬레이션 (실제 런웨이) ───
  const projections: MonthProjection[] = [];
  let remaining = totalAvailable;
  const maxMonths = 120;

  for (let i = 0; i < maxMonths && remaining > 0; i++) {
    const month = addBillingMonths(billingMonth, i);
    const installmentSum = installments
      .filter((inst) => inst.remaining > i)
      .reduce((s, inst) => s + inst.amount, 0);
    const plannedSum = allPlanned
      .filter((p) => p.year_month === month)
      .reduce((s, p) => s + p.amount, 0);

    const locked = fixedMonthly + installmentSum + plannedSum;
    const netBurn = locked + simulationFreeBudget;

    remaining -= netBurn;

    projections.push({
      month,
      fixed: fixedMonthly,
      installments: installmentSum,
      locked,
      free_budget: simulationFreeBudget,
      income: 0,
      net_burn: netBurn,
      remaining: Math.max(remaining, 0),
    });

    if (remaining <= 0) break;
  }

  // 실제 런웨이 계산
  let actualRunwayMonths = 0;
  let actualRunwayDate = billingMonth;
  if (projections.length > 0) {
    const last = projections.at(-1)!;
    if (remaining <= 0) {
      // 마지막 달에 소진: 소수점으로 정밀 계산
      const prevRemaining = last.remaining + last.net_burn;
      const fraction = prevRemaining / last.net_burn;
      actualRunwayMonths = Math.round((projections.length - 1 + fraction) * 10) / 10;
    } else {
      actualRunwayMonths = projections.length;
    }
    actualRunwayDate = last.month;
  }

  return {
    effective_available: totalAvailable,
    snapshot_total: effectiveData.snapshot_total,
    fixed_monthly: fixedMonthly,
    target_date: validTarget,
    free_per_month: freePerMonth,
    dynamic_daily: dynamicDaily,
    month_budget_remaining: monthBudgetRemaining,
    cycle_days: budgetDays,
    cycle_remaining_days: cycleRemainingDays,
    cycle_elapsed: cycleElapsed,
    flexible_spent: flexibleSpent,
    current_month_income: currentMonthIncome,
    actual_runway_months: actualRunwayMonths,
    actual_runway_date: actualRunwayDate,
    projections,
    total_remaining_days: totalRemainingDays,
    avg_variable_monthly: avgVariableMonthly,
    today_budget: todayBudget,
    today_flex_spent: todayFlexSpent,
    today_remaining: todayRemaining,
  };
}
