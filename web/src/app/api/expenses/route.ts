import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import {
  queryExpenses,
  queryExpensesByBillingMonth,
  createExpense,
  createInstallmentExpenses,
  isPlannedExpenseOwned,
} from '@/features/budget/lib/queries';
import { VALID_CATEGORIES } from '@/features/budget/lib/types';
import {
  parseIdParam,
  parseInstallmentMonths,
  validateExpenseFields,
} from '@/features/budget/lib/validate-input';
import { getTodayISO } from '@/lib/kst';

export async function GET(request: Request) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category') ?? undefined;

    if (category && !VALID_CATEGORIES.has(category)) {
      return NextResponse.json({ error: '유효하지 않은 category입니다' }, { status: 400 });
    }

    // billing_month 기준 조회 (카드별 결제주기 반영)
    const yearMonth = searchParams.get('yearMonth');
    if (yearMonth) {
      if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
        return NextResponse.json(
          { error: 'yearMonth 형식이 올바르지 않습니다 (YYYY-MM)' },
          { status: 400 },
        );
      }
      const data = await queryExpensesByBillingMonth(userId, yearMonth, category);
      return NextResponse.json({ data });
    }

    // 날짜 범위 기준 조회 (기존 호환)
    const today = getTodayISO();
    const from = searchParams.get('from') ?? today.slice(0, 7) + '-01';
    const to = searchParams.get('to') ?? today;
    const rawPlannedId = searchParams.get('planned_expense_id');
    const plannedExpenseId = rawPlannedId ? parseIdParam(rawPlannedId) : undefined;
    if (plannedExpenseId === null) {
      return NextResponse.json({ error: '잘못된 planned_expense_id' }, { status: 400 });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return NextResponse.json(
        { error: 'from/to 날짜 형식이 올바르지 않습니다 (YYYY-MM-DD)' },
        { status: 400 },
      );
    }

    const data = await queryExpenses(userId, from, to, category, plannedExpenseId);
    return NextResponse.json({ data });
  } catch (err) {
    console.error('[Expense API]', request.url, err);
    return NextResponse.json({ error: '지출 조회 실패' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const raw = (await request.json()) as unknown;
    if (typeof raw !== 'object' || raw === null) {
      return NextResponse.json({ error: '요청 본문이 올바르지 않습니다' }, { status: 400 });
    }

    // 수입이면 수입 카테고리, 지출이면 지출 카테고리로 검증한다
    const fieldError = validateExpenseFields(raw as Record<string, unknown>, 'create');
    if (fieldError) {
      return NextResponse.json({ error: fieldError }, { status: 400 });
    }
    // 아래 타입은 validateExpenseFields를 통과한 뒤의 모양이다
    const body = raw as {
      date: string;
      amount: number;
      category: string;
      description?: string | null;
      payment_method?: string;
      memo?: string | null;
      type?: 'expense' | 'income';
      planned_expense_id?: number | null;
      installment_months?: unknown;
      exclude_from_budget?: unknown;
      distribute_to_budget?: unknown;
    };
    const entryType = body.type ?? 'expense';

    // 할부 처리 (카드 2~12개월). 범위를 벗어난 값은 일시불로 바꾸지 않고 막는다
    const installment = parseInstallmentMonths(body.installment_months);
    if ('error' in installment) {
      return NextResponse.json({ error: installment.error }, { status: 400 });
    }

    if (
      body.planned_expense_id != null &&
      !(await isPlannedExpenseOwned(userId, body.planned_expense_id))
    ) {
      return NextResponse.json({ error: '예정 지출을 찾을 수 없습니다' }, { status: 400 });
    }

    const excludeFromBudget =
      typeof body.exclude_from_budget === 'boolean' ? body.exclude_from_budget : false;

    // 예산 제외 카테고리(리커밋 사업 등)를 할부로 넣으면 클라이언트가 exclude 토글 값을 실어 보내는데,
    // 할부 행은 예외 없이 묶인 돈이라 그 조합을 저장할 수 없다 (#549). 여기서 값을 넘기지 않는다.
    const installmentMonths = installment.data;
    if (installmentMonths >= 2) {
      const data = await createInstallmentExpenses(userId, {
        date: body.date,
        totalAmount: body.amount,
        months: installmentMonths,
        category: body.category,
        description: body.description,
        payment_method: body.payment_method,
        memo: body.memo,
        type: entryType,
      });
      return NextResponse.json({ data }, { status: 201 });
    }

    // 일반 지출 (일시불 또는 현금)
    const data = await createExpense(userId, {
      date: body.date,
      amount: body.amount,
      category: body.category,
      description: body.description,
      payment_method: body.payment_method,
      memo: body.memo,
      type: entryType,
      planned_expense_id: body.planned_expense_id ?? null,
      exclude_from_budget: excludeFromBudget,
      distribute_to_budget:
        typeof body.distribute_to_budget === 'boolean' ? body.distribute_to_budget : false,
    });
    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    console.error('[Expense API]', request.url, err);
    return NextResponse.json({ error: '지출 추가 실패' }, { status: 500 });
  }
}
