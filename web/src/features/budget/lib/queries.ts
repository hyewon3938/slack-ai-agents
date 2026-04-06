import { query, queryOne } from '@/lib/db';
import type {
  ExpenseRow,
  FixedCostRow,
  BudgetRow,
  AssetRow,
  MonthSummary,
  CategoryStat,
} from '@/lib/types';

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

/** 월간 요약: 총 지출, 카테고리별, 예산 대비 */
export async function queryMonthSummary(userId: number, yearMonth: string): Promise<MonthSummary> {
  const from = `${yearMonth}-01`;
  // 월 마지막일 계산
  const [year, month] = yearMonth.split('-').map(Number);
  const to = new Date(year, month, 0).toISOString().slice(0, 10);

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

  // 고정비 카테고리 제외한 가변 지출
  const FIXED_CATEGORIES = new Set(['통신비', '공과금']);
  const variableTotal = byCategory
    .filter((c) => !FIXED_CATEGORIES.has(c.category))
    .reduce((s, c) => s + c.total, 0);

  // 이 달 실제 날짜 수
  const daysInMonth = new Date(year, month, 0).getDate();
  const dailyAvg = total > 0 ? Math.round(total / daysInMonth) : 0;

  return {
    year_month: yearMonth,
    total,
    budget,
    fixed_total: fixedTotal,
    variable_total: variableTotal,
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
  total_available: number;       // 총 가용 자금 (비상금 제외)
  emergency_available: number;   // 비상금 포함 총액
  fixed_monthly: number;         // 월 고정비 합계
  avg_variable_monthly: number;  // 최근 3개월 평균 가변 지출
  estimated_monthly_net: number; // 월 순지출 추정
  runway_months: number;         // 런웨이 (개월)
  runway_date: string;           // 런웨이 종료 예상일 (YYYY-MM)
}

export async function queryRunway(userId: number): Promise<RunwayResult> {
  const [assets, fixedCosts] = await Promise.all([
    queryAssets(userId),
    queryFixedCosts(userId),
  ]);

  const totalAvailable = assets
    .filter((a) => !a.is_emergency)
    .reduce((s, a) => s + (a.available_amount ?? a.balance), 0);

  const emergencyAvailable = assets.reduce((s, a) => s + (a.available_amount ?? a.balance), 0);

  const fixedMonthly = fixedCosts
    .filter((fc) => fc.active)
    .reduce((s, fc) => s + fc.amount, 0);

  // 최근 3개월 가변 지출 평균
  const { rows: variableRows } = await query<{ avg_monthly: string }>(
    `SELECT COALESCE(AVG(monthly_total), 0) as avg_monthly
     FROM (
       SELECT DATE_TRUNC('month', date) as month, SUM(amount) as monthly_total
       FROM expenses
       WHERE user_id = $1
         AND date >= NOW() - INTERVAL '3 months'
         AND category NOT IN ('통신비', '공과금', '환불')
       GROUP BY 1
     ) sub`,
    [userId],
  );

  const avgVariableMonthly = Math.round(Number(variableRows[0]?.avg_monthly ?? 0));
  // 리커밋 평균 수입 추정 (네이버 즉시 정산 기준 ~60만)
  const ESTIMATED_INCOME = 600_000;
  const estimatedMonthlyNet = Math.max(fixedMonthly + avgVariableMonthly - ESTIMATED_INCOME, 1);
  const runwayMonths = totalAvailable / estimatedMonthlyNet;

  const runwayDate = (() => {
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth() + Math.floor(runwayMonths), 1);
    return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}`;
  })();

  return {
    total_available: totalAvailable,
    emergency_available: emergencyAvailable,
    fixed_monthly: fixedMonthly,
    avg_variable_monthly: avgVariableMonthly,
    estimated_monthly_net: estimatedMonthlyNet,
    runway_months: Math.round(runwayMonths * 10) / 10,
    runway_date: runwayDate,
  };
}
