import { query } from '@/lib/db';
import { addBillingMonths } from '../billing/cycle';
import { IMMEDIATE_PAYMENT_METHODS } from '../billing/payment-methods';

function subtractOneDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// 자유 지출 = directFlex + plannedOverflow.
// directFlex: 비할부만 (할부는 전부 묶인 돈으로 분리 — #539, ADR 0051), 예정지출 연결 건 제외.
// plannedOverflow: 예정지출 예산 초과분 (capped 금액은 예정 락에 귀속).
// 두 정의가 통합되어야 화면/정산/일별 로그가 정합.
export async function readFlexibleSpent(
  userId: number,
  billingMonth: string,
  upToDate: string,
): Promise<number> {
  const [directResult, overflow] = await Promise.all([
    query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS total
       FROM expenses
       WHERE user_id = $1
         AND COALESCE(type, 'expense') = 'expense'
         AND exclude_from_budget = false
         AND planned_expense_id IS NULL
         AND billing_month = $2
         AND date <= $3
         AND is_installment = false`,
      [userId, billingMonth, upToDate],
    ),
    readPlannedOverflow(userId, billingMonth, upToDate),
  ]);
  return Number(directResult.rows[0]?.total ?? 0) + overflow;
}

// 결제주기 전체 결제분 — 그 billing_month의 모든 type=expense 합 (#539, ADR 0051).
// 정산(depletion) 시 자금에서 차감할 금액. 할부 회차·고정비·예정·자유 전부 포함
// (실제 통장에서 빠져나간 총액). 자유 지출의 plannedOverflow 보정과 무관한 raw 합.
export async function readTotalCycleSpent(userId: number, billingMonth: string): Promise<number> {
  const result = await query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS total
     FROM expenses
     WHERE user_id = $1
       AND COALESCE(type, 'expense') = 'expense'
       AND billing_month = $2`,
    [userId, billingMonth],
  );
  return Number(result.rows[0]?.total ?? 0);
}

// 제외 지출 = 일반(비할부) 지출 중 예산 미포함분만 (#539/ADR 0051, #549).
// 할부는 exclude 대상이 아니라 묶인 돈으로 따로 집계되므로 여기서 제외해야
// 정산 스냅샷 분해(총 결제분 = 자유 + 할부 + 제외)가 왜곡되지 않는다.
export async function readExcludedSpent(userId: number, billingMonth: string): Promise<number> {
  const result = await query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS total
     FROM expenses
     WHERE user_id = $1
       AND COALESCE(type, 'expense') = 'expense'
       AND exclude_from_budget = true
       AND is_installment = false
       AND billing_month = $2`,
    [userId, billingMonth],
  );
  return Number(result.rows[0]?.total ?? 0);
}

// 예산 기준선 복원분 — "이미 통장에서 나갔는데 예산이 또 뺄" 지출의 합 (#615, ADR 0062).
// 복원 제외: 예산이 애초에 세지 않는 지출(비할부 일반 지출의 exclude). 복원하면 없는 돈이 생긴다.
// 복원 포함: 고정비 자동 기록(source='fixed')과 할부 회차 — exclude 플래그와 무관하게
//            묶인 돈으로 계상되므로 잔액과 예산 양쪽에서 이중으로 빠진다.
export async function readReflectedBudgetOutflow(
  userId: number,
  billingMonth: string,
  asOf: string,
): Promise<number> {
  const result = await query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS total
     FROM expenses
     WHERE user_id = $1
       AND COALESCE(type, 'expense') = 'expense'
       AND billing_month = $2
       AND date <= $3
       AND payment_method = ANY($4)
       AND NOT (
         COALESCE(exclude_from_budget, false) = true
         AND source IS DISTINCT FROM 'fixed'
         AND COALESCE(is_installment, false) = false
       )`,
    [userId, billingMonth, asOf, IMMEDIATE_PAYMENT_METHODS],
  );
  return Number(result.rows[0]?.total ?? 0);
}

// 정산 오프셋 — 기준일까지 이미 통장에서 나간 전액 (예산 계상 여부 무관).
// 정산은 회계라 raw 총액 기준. readTotalCycleSpent에서 이만큼 빼야 이중 차감이 안 된다.
export async function readReflectedOutflow(
  userId: number,
  billingMonth: string,
  asOf: string,
): Promise<number> {
  const result = await query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS total
     FROM expenses
     WHERE user_id = $1
       AND COALESCE(type, 'expense') = 'expense'
       AND billing_month = $2
       AND date <= $3
       AND payment_method = ANY($4)`,
    [userId, billingMonth, asOf, IMMEDIATE_PAYMENT_METHODS],
  );
  return Number(result.rows[0]?.total ?? 0);
}

// 일 단위 plannedOverflow 산식: today까지의 누적 overflow - yesterday까지의 누적 overflow.
// 누적 초과가 처음 발생한 날 그 증가분만 그날 자유지출로 가산되고,
// 이미 초과 상태에서 추가 지출하면 그 지출 전체가 그날 자유지출로 가산된다.
// Math.max(0, ...)는 환불·조정 케이스 음수 방어.
export async function readTodayFlexSpent(
  userId: number,
  today: string,
  billingMonth: string,
): Promise<number> {
  const yesterday = subtractOneDay(today);
  const [directResult, todayOverflow, yesterdayOverflow] = await Promise.all([
    query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS total
       FROM expenses
       WHERE user_id = $1
         AND COALESCE(type, 'expense') = 'expense'
         AND exclude_from_budget = false
         AND planned_expense_id IS NULL
         AND date = $2::date
         AND is_installment = false`,
      [userId, today],
    ),
    readPlannedOverflow(userId, billingMonth, today),
    readPlannedOverflow(userId, billingMonth, yesterday),
  ]);
  const direct = Number(directResult.rows[0]?.total ?? 0);
  const dailyOverflow = Math.max(0, todayOverflow - yesterdayOverflow);
  return direct + dailyOverflow;
}

// 예정지출별 누적 사용량이 예산을 초과한 부분의 합.
// Σ max(0, used(p, upToDate) - p.amount). 미달/일치는 0, 초과한 만큼만 가산.
// upToDate 파라미터화로 일/월 단위 모두 같은 함수 재사용.
export async function readPlannedOverflow(
  userId: number,
  billingMonth: string,
  upToDate: string,
): Promise<number> {
  const result = await query<{ overflow: string }>(
    `SELECT COALESCE(SUM(GREATEST(used - budget, 0)), 0)::text AS overflow
     FROM (
       SELECT p.amount AS budget, COALESCE(SUM(e.amount), 0) AS used
       FROM planned_expenses p
       LEFT JOIN expenses e
         ON e.planned_expense_id = p.id
         AND e.user_id = p.user_id
         AND e.billing_month = $2
         AND e.date <= $3
       WHERE p.user_id = $1
       GROUP BY p.id, p.amount
     ) sub`,
    [userId, billingMonth, upToDate],
  );
  return Number(result.rows[0]?.overflow ?? 0);
}

// 최근 N개 '완결된' 결제주기의 자유(변동) 지출 월평균 — 페이스 전망의 freePerMonth 추정치.
// - is_installment=false: 할부 회차는 예측 시 락 맵으로 따로 burn되므로 평균에 넣으면 이중 계상.
// - planned_expense_id IS NULL: 예정지출 연결분도 예측에서 planned로 따로 반영 → 제외.
// - billing_month 기준 [current-N, current): 결제주기 단위로 집계하고 진행 중 주기(부분)는 제외
//   (달력월 DATE_TRUNC나 부분 주기가 평균을 끌어내리는 것 방지).
export async function readAvgVariableMonthly(
  userId: number,
  months: number,
  currentBillingMonth: string,
): Promise<number> {
  const windowStart = addBillingMonths(currentBillingMonth, -months);
  const result = await query<{ avg_monthly: string }>(
    `SELECT COALESCE(AVG(monthly_total), 0) AS avg_monthly
     FROM (
       SELECT billing_month, SUM(amount) AS monthly_total
       FROM expenses
       WHERE user_id = $1
         AND COALESCE(type, 'expense') = 'expense'
         AND exclude_from_budget = false
         AND is_installment = false
         AND planned_expense_id IS NULL
         AND billing_month >= $2
         AND billing_month < $3
       GROUP BY billing_month
     ) sub`,
    [userId, windowStart, currentBillingMonth],
  );
  return Math.round(Number(result.rows[0]?.avg_monthly ?? 0));
}
