import { query } from '@/lib/db';
import { getTodayISO } from '@/lib/kst';
import { resolveFixedCostExpenseDate } from './billing/fixed-cost-date';
import { getBillingMonthForExpense } from './billing/card-billing';
import { DEFAULT_PAYMENT_METHOD } from './billing/payment-methods';
import type { FixedCostRow } from './types';

// 고정비 조회 + 자동 기록.
// facade(정산)와 queries(대시보드 조회) 양쪽에서 쓰이며, queries 가 facade 를 import 하므로
// 이 로직을 queries 에 두면 facade → queries → facade 순환이 생긴다. 별도 모듈로 분리해 순환을 끊는다.
// (이 파일은 facade / queries 를 import 하지 않는다.)

/** 고정비 목록 (active 먼저) */
export async function queryFixedCosts(userId: number): Promise<FixedCostRow[]> {
  const { rows } = await query<FixedCostRow>(
    `SELECT id, name, amount, category, is_variable, day_of_month, active, memo, payment_method
     FROM fixed_costs WHERE user_id = $1 ORDER BY active DESC, category, name`,
    [userId],
  );
  return rows;
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

  // 결제수단 미지정 고정비는 기본값으로 폴백 — 컬럼 도입 전 동작을 그대로 유지 (#615)
  const candidates = activeCostsWithDay
    .map((fc) => {
      const expenseDate = resolveFixedCostExpenseDate(yearMonth, fc.day_of_month!);
      return { fc, expenseDate, paymentMethod: fc.payment_method ?? DEFAULT_PAYMENT_METHOD };
    })
    .filter((c) => c.expenseDate <= todayStr)
    .map((c) => ({
      ...c,
      billingMonth: getBillingMonthForExpense(c.expenseDate, c.paymentMethod),
    }));

  if (candidates.length === 0) return 0;

  const result = await query(
    `INSERT INTO expenses
       (user_id, date, amount, category, description, payment_method, source, memo, type, exclude_from_budget, billing_month)
     SELECT $1, d.date, d.amount, d.category, d.description, d.payment_method, 'fixed', d.memo, 'expense', true, d.billing_month
     FROM UNNEST(
       $2::date[], $3::numeric[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[]
     ) AS d(date, amount, category, description, memo, billing_month, payment_method)
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
      candidates.map((c) => c.paymentMethod),
    ],
  );

  return result.rowCount ?? 0;
}
