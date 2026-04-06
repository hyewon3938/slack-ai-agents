import { query, queryOne } from '@/lib/db';
import type {
  ExpenseRow,
  FixedCostRow,
  BudgetRow,
  AssetRow,
  MonthSummary,
  CategoryStat,
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
            source, memo, created_at::text
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
            source, memo, created_at::text
     FROM expenses WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
}

/** 지출 추가 */
export async function createExpense(
  userId: number,
  data: {
    date: string;
    amount: number;
    category: string;
    description?: string | null;
    payment_method?: string;
    memo?: string | null;
  },
): Promise<ExpenseRow> {
  const row = await queryOne<ExpenseRow>(
    `INSERT INTO expenses (user_id, date, amount, category, description, payment_method, memo, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'manual')
     RETURNING id, date::text, amount, category, description, payment_method,
               is_installment, installment_num, installment_total, installment_group,
               source, memo, created_at::text`,
    [userId, data.date, data.amount, data.category, data.description ?? null, data.payment_method ?? '카드', data.memo ?? null],
  );
  if (!row) throw new Error('createExpense: INSERT returned no rows');
  return row;
}

/** 지출 수정 (허용 컬럼 화이트리스트) */
const EXPENSE_COLUMNS = new Set(['date', 'amount', 'category', 'description', 'payment_method', 'memo']);

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
               source, memo, created_at::text`,
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
      `SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE user_id = $1 AND date >= $2 AND date <= $3`,
      [userId, from, to],
    ),
    query<{ category: string; total: string; count: string }>(
      `SELECT category, SUM(amount) as total, COUNT(*) as count
       FROM expenses WHERE user_id = $1 AND date >= $2 AND date <= $3
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

  // 일평균/예산 계산에서 제외할 카테고리 (고정비, 사업비, 환불)
  const EXCLUDED_CATEGORIES = new Set(['통신비', '공과금', '리커밋 사업', '리커밋 택배', '환불']);
  const variableTotal = byCategory
    .filter((c) => !EXCLUDED_CATEGORIES.has(c.category))
    .reduce((s, c) => s + c.total, 0);

  // 할부 합계 (가변 카테고리 중 is_installment=true)
  const installmentResult = await query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0) as total FROM expenses
     WHERE user_id = $1 AND date >= $2 AND date <= $3
       AND is_installment = true
       AND category NOT IN ('통신비', '공과금', '리커밋 사업', '리커밋 택배', '환불')`,
    [userId, from, to],
  );
  const installmentTotal = Number(installmentResult.rows[0]?.total ?? 0);
  const flexibleSpent = variableTotal - installmentTotal;

  // 결제주기 일수 계산 (전월 16일 ~ 당월 15일)
  const fromDate = new Date(`${from}T00:00:00`);
  const toDate = new Date(`${to}T00:00:00`);
  const daysInCycle = Math.round((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const dailyAvg = variableTotal > 0 ? Math.round(variableTotal / daysInCycle) : 0;

  return {
    year_month: yearMonth,
    total,
    budget,
    fixed_total: fixedTotal,
    variable_total: variableTotal,
    installment_total: installmentTotal,
    flexible_spent: flexibleSpent,
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

// ─── 런웨이 계산 ──────────────────────────────────────

export interface RunwayResult {
  total_available: number;         // 총 가용 자금 (비상금 제외)
  fixed_monthly: number;           // 월 고정비 합계
  monthly_budget: number | null;   // 월 가변 예산 (설정값)
  avg_variable_monthly: number;    // 최근 3개월 평균 가변 지출
  budget_monthly_burn: number;     // 예산 기준 월 소진액 (고정비 + 가변예산 - 수입)
  actual_monthly_burn: number;     // 실제 월 소진액 (고정비 + 실제지출 - 수입)
  budget_runway_months: number;    // 예산대로 살 때 런웨이
  actual_runway_months: number;    // 실제 지출 기준 런웨이
  budget_runway_date: string;      // 예산 기준 종료일
  actual_runway_date: string;      // 실제 기준 종료일
  over_budget: number;             // 예산 초과분 누적 (양수 = 초과)
}

export async function queryRunway(userId: number): Promise<RunwayResult> {
  const now = new Date();
  const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const [assets, fixedCosts, currentBudget] = await Promise.all([
    queryAssets(userId),
    queryFixedCosts(userId),
    queryBudget(userId, currentYearMonth),
  ]);

  const totalAvailable = assets
    .filter((a) => !a.is_emergency)
    .reduce((s, a) => s + (a.available_amount ?? a.balance), 0);

  const fixedMonthly = fixedCosts
    .filter((fc) => fc.active)
    .reduce((s, fc) => s + fc.amount, 0);

  const monthlyBudget = currentBudget?.total_budget ?? null;

  // 최근 3개월 가변 지출 평균 (리커밋/환불 제외)
  const { rows: variableRows } = await query<{ avg_monthly: string }>(
    `SELECT COALESCE(AVG(monthly_total), 0) as avg_monthly
     FROM (
       SELECT DATE_TRUNC('month', date) as month, SUM(amount) as monthly_total
       FROM expenses
       WHERE user_id = $1
         AND date >= NOW() - INTERVAL '3 months'
         AND category NOT IN ('통신비', '공과금', '리커밋 사업', '리커밋 택배', '환불')
       GROUP BY 1
     ) sub`,
    [userId],
  );

  const avgVariableMonthly = Math.round(Number(variableRows[0]?.avg_monthly ?? 0));
  const estimatedIncome = Number(process.env.ESTIMATED_MONTHLY_INCOME ?? '0');

  // 예산 기준 런웨이: 예산대로 살면 얼마나 버틸 수 있는지
  const budgetVariable = monthlyBudget ?? avgVariableMonthly;
  const budgetMonthlyBurn = Math.max(fixedMonthly + budgetVariable - estimatedIncome, 1);
  const budgetRunwayMonths = totalAvailable / budgetMonthlyBurn;

  // 실제 기준 런웨이: 최근 소비 패턴 유지 시
  const actualMonthlyBurn = Math.max(fixedMonthly + avgVariableMonthly - estimatedIncome, 1);
  const actualRunwayMonths = totalAvailable / actualMonthlyBurn;

  // 예산 초과분: 실제 평균 - 예산 (양수면 초과)
  const overBudget = monthlyBudget !== null ? avgVariableMonthly - monthlyBudget : 0;

  const toDateStr = (months: number) => {
    const target = new Date(now.getFullYear(), now.getMonth() + Math.floor(months), 1);
    return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}`;
  };

  return {
    total_available: totalAvailable,
    fixed_monthly: fixedMonthly,
    monthly_budget: monthlyBudget,
    avg_variable_monthly: avgVariableMonthly,
    budget_monthly_burn: budgetMonthlyBurn,
    actual_monthly_burn: actualMonthlyBurn,
    budget_runway_months: Math.round(budgetRunwayMonths * 10) / 10,
    actual_runway_months: Math.round(actualRunwayMonths * 10) / 10,
    budget_runway_date: toDateStr(budgetRunwayMonths),
    actual_runway_date: toDateStr(actualRunwayMonths),
    over_budget: overBudget,
  };
}
