import { query } from '@/lib/db';

function subtractOneDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// 자유 지출 = directFlex + plannedOverflow.
// directFlex: 비할부 + 신규 할부 1회차, 예정지출 연결 건 제외.
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
         AND (
           is_installment = false
           OR (is_installment = true AND installment_num = 1)
         )`,
      [userId, billingMonth, upToDate],
    ),
    readPlannedOverflow(userId, billingMonth, upToDate),
  ]);
  return Number(directResult.rows[0]?.total ?? 0) + overflow;
}

export async function readExcludedSpent(userId: number, billingMonth: string): Promise<number> {
  const result = await query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS total
     FROM expenses
     WHERE user_id = $1
       AND COALESCE(type, 'expense') = 'expense'
       AND exclude_from_budget = true
       AND billing_month = $2`,
    [userId, billingMonth],
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
         AND (
           is_installment = false
           OR (is_installment = true AND installment_num = 1 AND billing_month = $3)
         )`,
      [userId, today, billingMonth],
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

/** 최근 N개월 변동 지출 월평균 (고정비 제외 일반 지출만) */
export async function readAvgVariableMonthly(userId: number, months = 3): Promise<number> {
  const result = await query<{ avg_monthly: string }>(
    `SELECT COALESCE(AVG(monthly_total), 0) AS avg_monthly
     FROM (
       SELECT DATE_TRUNC('month', date) AS month, SUM(amount) AS monthly_total
       FROM expenses
       WHERE user_id = $1
         AND date >= NOW() - ($2::text || ' months')::interval
         AND exclude_from_budget = false
         AND COALESCE(type, 'expense') = 'expense'
       GROUP BY 1
     ) sub`,
    [userId, months],
  );
  return Math.round(Number(result.rows[0]?.avg_monthly ?? 0));
}
