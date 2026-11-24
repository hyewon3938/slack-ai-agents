import { query, queryOne } from '@/lib/db';
import { getBillingRange, calcCycleDays } from '../billing/cycle';
import { readFlexibleSpent } from '../repository/expenses-repo';
import { queryFixedCosts } from '../fixed-cost-ensure';
import { queryPlannedExpenses } from './planned';
import type { MonthSummary, CategoryStat } from '../types';

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
