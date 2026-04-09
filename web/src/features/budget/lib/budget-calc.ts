/**
 * 예산 계산 순수 함수 모음
 * DB 조회 없이 계산만 수행 → 단위 테스트 용이
 */

// ─── 빌링 유틸리티 ──────────────────────────────────────────

/** 결제주기 기준 billing month 오프셋 계산 */
export function addBillingMonths(yearMonth: string, offset: number): string {
  const [y, m] = yearMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 현재 결제주기의 billing month (16일 이후면 다음달) */
export function getCurrentBillingMonth(now: Date): string {
  if (now.getDate() >= 16) {
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
  }
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** 결제주기 날짜 범위 (전월 16일 ~ 당월 15일) */
export function getBillingRange(yearMonth: string): { from: string; to: string } {
  const [year, month] = yearMonth.split('-').map(Number);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  return {
    from: `${prevYear}-${String(prevMonth).padStart(2, '0')}-16`,
    to: `${year}-${String(month).padStart(2, '0')}-15`,
  };
}

/** 결제주기 일수 계산 (from ~ to 포함) */
export function calcCycleDays(from: string, to: string): number {
  return (
    Math.round(
      (new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86400000,
    ) + 1
  );
}

// ─── 예산 배분 계산 ──────────────────────────────────────────

/** 할부 프로젝션 단위 */
export interface InstallmentProjection {
  amount: number;
  remaining: number; // 남은 회차
  isNew: boolean;    // 예산 시작일 이후 생성 → month 0에서 locked 제외
}

/** 예산 계산 입력 (DB 조회 결과를 정리한 것) */
export interface BudgetCalcInput {
  totalAvailable: number;       // getEffectiveAvailable().effective
  fixedMonthly: number;         // active 고정비 합계
  installments: InstallmentProjection[];
  plannedExpenses: Array<{ year_month: string; amount: number }>;
  billingMonth: string;         // 현재 billing month (e.g. '2026-04')
  targetDate: string | null;    // 목표 기간 (e.g. '2026-08')
  budgetDays: number;           // tracking 시작일 ~ 주기 끝 일수
  cycleDays: number;            // 전체 주기 일수
  flexibleSpent: number;        // 이번 주기 자유 지출
  currentMonthIncome: number;   // 이번 달 수입
}

/** 월별 잠긴 돈 상세 */
export interface MonthLocked {
  month: string;
  fixed: number;
  installments: number;
  planned: number;
  total: number;
  days: number; // 해당 월에 배정된 예산 일수
}

/** 예산 배분 계산 결과 */
export interface BudgetCalcResult {
  budgetBase: number;           // 보정된 가용자금
  freePerMonth: number | null;  // 월 자유 예산 (null = 목표 미설정)
  dailyFree: number;            // 일일 자유 예산 (소수점)
  totalLocked: number;          // 미래 잠긴 돈 합계
  monthlyLocked: MonthLocked[]; // 월별 잠긴 돈 상세
}

/**
 * 예산 배분 계산 (순수 함수)
 *
 * 핵심 원리:
 * - budgetBase = totalAvailable + flexibleSpent - currentMonthIncome
 *   (이번 달 자유 지출을 복원해 "주기 시작 시점" 가용자금으로 맞추고,
 *    수입은 이번 달에만 반영해 미래 월 예산 부풀림 방지)
 * - 현재 달 locked는 budgetDays/cycleDays 비율로 프로레이션
 * - 신규 할부(isNew)는 month 0에서 locked 제외 (자유 지출로 이미 반영)
 * - freePerMonth = dailyFree * cycleDays (월 기준 일관성)
 */
export function calculateBudgetAllocation(input: BudgetCalcInput): BudgetCalcResult {
  const {
    totalAvailable, fixedMonthly, installments, plannedExpenses,
    billingMonth, targetDate, budgetDays, cycleDays,
    flexibleSpent, currentMonthIncome,
  } = input;

  // 1. budgetBase: 자유 지출 복원 + 수입 격리
  const budgetBase = totalAvailable + flexibleSpent - currentMonthIncome;

  // 2. 목표 기간 유효성 확인
  if (!targetDate || !/^\d{4}-\d{2}$/.test(targetDate)) {
    return { budgetBase, freePerMonth: null, dailyFree: 0, totalLocked: 0, monthlyLocked: [] };
  }

  const [ty, tm] = targetDate.split('-').map(Number);
  const [by, bm] = billingMonth.split('-').map(Number);
  const targetMonths = (ty - by) * 12 + (tm - bm) + 1;
  if (targetMonths <= 0) {
    return { budgetBase, freePerMonth: null, dailyFree: 0, totalLocked: 0, monthlyLocked: [] };
  }

  // 3. 월별 잠긴 돈 + 일수 계산
  let totalLocked = 0;
  const monthlyLocked: MonthLocked[] = [];
  const daysArr: number[] = [];

  for (let i = 0; i < targetMonths; i++) {
    const month = addBillingMonths(billingMonth, i);

    const installmentSum = installments
      .filter((inst) => inst.remaining > i && (i > 0 || !inst.isNew))
      .reduce((s, inst) => s + inst.amount, 0);

    const plannedSum = plannedExpenses
      .filter((p) => p.year_month === month)
      .reduce((s, p) => s + p.amount, 0);

    const monthTotal = fixedMonthly + installmentSum + plannedSum;

    const { from: mf, to: mt } = getBillingRange(month);
    const mDays = calcCycleDays(mf, mt);
    const assignedDays = i === 0 ? budgetDays : mDays;
    daysArr.push(assignedDays);

    if (i === 0) {
      // 현재 달: budgetDays/cycleDays 비율 (이미 납부된 고정비는 가용자금에 반영됨)
      const ratio = cycleDays > 0 ? budgetDays / cycleDays : 0;
      totalLocked += Math.round(monthTotal * ratio);
    } else {
      totalLocked += monthTotal;
    }

    monthlyLocked.push({
      month,
      fixed: fixedMonthly,
      installments: installmentSum,
      planned: plannedSum,
      total: monthTotal,
      days: assignedDays,
    });
  }

  // 4. 자유 예산 분배
  const totalFree = Math.max(0, budgetBase - totalLocked);
  const sumDays = daysArr.reduce((s, d) => s + d, 0);
  const dailyFree = sumDays > 0 ? totalFree / sumDays : 0;
  const freePerMonth = Math.round(dailyFree * cycleDays);

  return { budgetBase, freePerMonth, dailyFree, totalLocked, monthlyLocked };
}
