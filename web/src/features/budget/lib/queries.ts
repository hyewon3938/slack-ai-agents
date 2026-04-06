import { query, queryOne } from '@/lib/db';
import type {
  ExpenseRow,
  FixedCostRow,
  BudgetRow,
  AssetRow,
  MonthSummary,
  CategoryStat,
  MonthProjection,
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

  // 일평균/예산 계산에서 제외할 카테고리 (고정비, 사업비)
  const EXCLUDED_CATEGORIES = new Set(['통신비', '공과금', '리커밋 사업', '리커밋 택배']);
  // 환불은 별도 집계 (수입 성격)
  const refundTotal = byCategory
    .filter((c) => c.category === '환불')
    .reduce((s, c) => s + c.total, 0);
  const variableTotal = byCategory
    .filter((c) => !EXCLUDED_CATEGORIES.has(c.category) && c.category !== '환불')
    .reduce((s, c) => s + c.total, 0);

  // 할부 합계 (가변 카테고리 중 is_installment=true)
  const installmentResult = await query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0) as total FROM expenses
     WHERE user_id = $1 AND date >= $2 AND date <= $3
       AND is_installment = true
       AND category NOT IN ('통신비', '공과금', '리커밋 사업', '리커밋 택배')`,
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
    refund_total: refundTotal,
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

/**
 * 고정비 자동 기록: 결제일(day_of_month)이 설정된 활성 고정비에 대해
 * 해당 결제주기 내에 지출 기록이 없으면 자동 생성.
 * - 미래 날짜는 생성하지 않음 (오늘까지만)
 * - source='fixed'로 구분, 삭제 후에도 기록은 유지
 */
export async function ensureFixedCostExpenses(userId: number, yearMonth: string): Promise<number> {
  const [year, month] = yearMonth.split('-').map(Number);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;

  const fixedCosts = await queryFixedCosts(userId);
  const activeCostsWithDay = fixedCosts.filter((fc) => fc.active && fc.day_of_month);

  if (activeCostsWithDay.length === 0) return 0;

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  let created = 0;

  for (const fc of activeCostsWithDay) {
    const day = fc.day_of_month!;

    // 결제주기 내 실제 날짜 계산
    // day >= 16 → 전월 (결제주기 시작 쪽), day <= 15 → 당월 (결제주기 끝 쪽)
    let expenseYear: number, expenseMonth: number;
    if (day >= 16) {
      expenseYear = prevYear;
      expenseMonth = prevMonth;
    } else {
      expenseYear = year;
      expenseMonth = month;
    }

    // 해당 월의 실제 마지막 일자 확인 (31일이 없는 달 처리)
    const lastDay = new Date(expenseYear, expenseMonth, 0).getDate();
    const actualDay = Math.min(day, lastDay);
    const expenseDate = `${expenseYear}-${String(expenseMonth).padStart(2, '0')}-${String(actualDay).padStart(2, '0')}`;

    // 미래 날짜는 스킵
    if (expenseDate > todayStr) continue;

    // 이미 기록된 건이 있는지 확인 (source='fixed', 같은 날짜, 같은 이름)
    const existing = await queryOne<{ id: number }>(
      `SELECT id FROM expenses
       WHERE user_id = $1 AND source = 'fixed' AND date = $2 AND description = $3`,
      [userId, expenseDate, fc.name],
    );

    if (existing) continue;

    // 자동 생성
    await queryOne(
      `INSERT INTO expenses (user_id, date, amount, category, description, payment_method, source, memo)
       VALUES ($1, $2, $3, $4, $5, '카드', 'fixed', $6)
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

// ─── 런웨이 계산 (월별 시뮬레이션) ──────────────────────

export interface RunwayResult {
  total_available: number;           // 총 가용 자금 (비상금 제외)
  fixed_monthly: number;             // 월 고정비 합계
  monthly_budget: number | null;     // 월 가변 예산 (설정값)
  avg_variable_monthly: number;      // 최근 3개월 평균 가변 지출
  projections: MonthProjection[];    // 월별 시뮬레이션 결과
  budget_runway_months: number;      // 시뮬레이션 기반 런웨이 (개월)
  budget_runway_date: string;        // 런웨이 종료월
  target_date: string | null;        // 목표 기간 (YYYY-MM)
  recommended_budget: number | null; // 목표 기간 기반 추천 자유 예산
  recommended_daily: number | null;  // 추천 일일 자유 예산
  // 현재 결제주기 추적
  daily_target: number | null;       // 일일 목표 (자유 예산 / 결제주기 일수)
  cycle_days: number;                // 결제주기 일수
  cycle_elapsed: number;             // 경과 일수
  flexible_spent: number;            // 현재 주기 자유 지출
  cumulative_saved: number;          // (일일목표 × 경과일) - 실제 자유지출
}

/** 결제주기 기준 billing month 오프셋 계산 */
function addBillingMonths(yearMonth: string, offset: number): string {
  const [y, m] = yearMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 현재 결제주기의 billing month (16일 이후면 다음달) */
function getCurrentBillingMonth(now: Date): string {
  if (now.getDate() >= 16) {
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
  }
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** 결제주기 날짜 범위 (전월 16일 ~ 당월 15일) */
function getBillingRange(yearMonth: string): { from: string; to: string } {
  const [year, month] = yearMonth.split('-').map(Number);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  return {
    from: `${prevYear}-${String(prevMonth).padStart(2, '0')}-16`,
    to: `${year}-${String(month).padStart(2, '0')}-15`,
  };
}

export async function queryRunway(userId: number, targetDate?: string): Promise<RunwayResult> {
  const now = new Date();
  const billingMonth = getCurrentBillingMonth(now);

  const [assets, fixedCosts, currentBudget, installmentRows, variableRows] = await Promise.all([
    queryAssets(userId),
    queryFixedCosts(userId),
    queryBudget(userId, billingMonth),
    // 할부 그룹별 최신 레코드 (남은 회차 계산용)
    query<{
      installment_group: string;
      installment_num: number;
      installment_total: number;
      amount: number;
    }>(
      `SELECT DISTINCT ON (installment_group)
         installment_group, installment_num, installment_total, amount
       FROM expenses
       WHERE user_id = $1 AND is_installment = true AND installment_group IS NOT NULL
       ORDER BY installment_group, date DESC, created_at DESC`,
      [userId],
    ),
    // 최근 3개월 가변 지출 평균 (고정비/사업비/환불 제외)
    query<{ avg_monthly: string }>(
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
    ),
  ]);

  // 기본 수치
  const totalAvailable = assets
    .filter((a) => !a.is_emergency)
    .reduce((s, a) => s + (a.available_amount ?? a.balance), 0);

  const fixedMonthly = fixedCosts
    .filter((fc) => fc.active)
    .reduce((s, fc) => s + fc.amount, 0);

  const monthlyBudget = currentBudget?.total_budget ?? null;
  const avgVariableMonthly = Math.round(Number(variableRows.rows[0]?.avg_monthly ?? 0));
  const estimatedIncome = Number(process.env.ESTIMATED_MONTHLY_INCOME ?? '0');
  const budgetVariable = monthlyBudget ?? avgVariableMonthly;

  // 할부 프로젝션: 그룹별 남은 회차와 월 금액
  const installments = installmentRows.rows
    .filter((r) => r.installment_total > r.installment_num)
    .map((r) => ({
      amount: r.amount,
      remaining: r.installment_total - r.installment_num,
    }));

  // ─── 월별 시뮬레이션 ───
  const projections: MonthProjection[] = [];
  let remaining = totalAvailable;
  const maxMonths = 120;

  for (let i = 1; i <= maxMonths && remaining > 0; i++) {
    const month = addBillingMonths(billingMonth, i);
    // 해당 월의 할부 합계 (남은 회차가 i 이상인 그룹만)
    const installmentSum = installments
      .filter((inst) => inst.remaining >= i)
      .reduce((s, inst) => s + inst.amount, 0);

    const locked = fixedMonthly + installmentSum;
    const freeBudget = budgetVariable;
    const netBurn = locked + freeBudget - estimatedIncome;

    remaining -= netBurn;

    projections.push({
      month,
      fixed: fixedMonthly,
      installments: installmentSum,
      locked,
      free_budget: freeBudget,
      income: estimatedIncome,
      net_burn: netBurn,
      remaining: Math.max(remaining, 0),
    });

    if (remaining <= 0) break;
  }

  const budgetRunwayMonths = projections.length > 0
    ? projections.length - 1 + (remaining <= 0
        ? (projections.at(-1)!.remaining + projections.at(-1)!.net_burn) / projections.at(-1)!.net_burn
        : projections.length)
    : 0;
  const budgetRunwayDate = projections.length > 0
    ? (remaining <= 0 ? projections.at(-1)!.month : addBillingMonths(billingMonth, maxMonths))
    : billingMonth;

  // ─── 목표 기간 기반 추천 예산 (할부 차등 반영) ───
  const validTarget = targetDate && /^\d{4}-\d{2}$/.test(targetDate) ? targetDate : null;
  let recommendedBudget: number | null = null;
  let recommendedDaily: number | null = null;

  if (validTarget) {
    const [ty, tm] = validTarget.split('-').map(Number);
    const targetMonths = (ty - now.getFullYear()) * 12 + (tm - now.getMonth() - 1);
    if (targetMonths > 0) {
      // 목표까지 각 월의 잠긴 돈 합계 (고정비 + 할부)
      let totalLocked = 0;
      for (let i = 1; i <= targetMonths; i++) {
        const installmentSum = installments
          .filter((inst) => inst.remaining >= i)
          .reduce((s, inst) => s + inst.amount, 0);
        totalLocked += fixedMonthly + installmentSum;
      }
      const totalIncome = estimatedIncome * targetMonths;
      const availableForFree = totalAvailable - totalLocked + totalIncome;
      recommendedBudget = Math.max(Math.round(availableForFree / targetMonths), 0);

      // 추천 일일 예산 (결제주기 일수 기준)
      const { from, to } = getBillingRange(billingMonth);
      const cycleDays = Math.round(
        (new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86400000,
      ) + 1;
      recommendedDaily = cycleDays > 0 ? Math.round(recommendedBudget / cycleDays) : null;
    }
  }

  // ─── 현재 결제주기 추적 ───
  const { from: cycleFrom, to: cycleTo } = getBillingRange(billingMonth);
  const cycleFromDate = new Date(`${cycleFrom}T00:00:00`);
  const cycleToDate = new Date(`${cycleTo}T00:00:00`);
  const cycleDays = Math.round((cycleToDate.getTime() - cycleFromDate.getTime()) / 86400000) + 1;

  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const todayDate = new Date(`${todayStr}T00:00:00`);
  const cycleElapsed = Math.max(
    0,
    Math.min(
      cycleDays,
      Math.round((todayDate.getTime() - cycleFromDate.getTime()) / 86400000) + 1,
    ),
  );

  // 현재 주기 자유 지출 (가변 - 할부 - 제외 카테고리 - 환불)
  const flexResult = await query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0) as total FROM expenses
     WHERE user_id = $1 AND date >= $2 AND date <= $3
       AND is_installment = false
       AND category NOT IN ('통신비', '공과금', '리커밋 사업', '리커밋 택배', '환불')`,
    [userId, cycleFrom, todayStr < cycleTo ? todayStr : cycleTo],
  );
  const flexibleSpent = Number(flexResult.rows[0]?.total ?? 0);

  // 일일 목표: 추천예산 > 설정예산 > 평균 순으로 사용
  const freeBudgetForDaily = recommendedBudget ?? monthlyBudget ?? avgVariableMonthly;
  const dailyTarget = cycleDays > 0 ? Math.round(freeBudgetForDaily / cycleDays) : null;
  const cumulativeSaved = dailyTarget !== null
    ? Math.round(dailyTarget * cycleElapsed - flexibleSpent)
    : 0;

  return {
    total_available: totalAvailable,
    fixed_monthly: fixedMonthly,
    monthly_budget: monthlyBudget,
    avg_variable_monthly: avgVariableMonthly,
    projections,
    budget_runway_months: Math.round(budgetRunwayMonths * 10) / 10,
    budget_runway_date: budgetRunwayDate,
    target_date: validTarget,
    recommended_budget: recommendedBudget,
    recommended_daily: recommendedDaily,
    daily_target: dailyTarget,
    cycle_days: cycleDays,
    cycle_elapsed: cycleElapsed,
    flexible_spent: flexibleSpent,
    cumulative_saved: cumulativeSaved,
  };
}
