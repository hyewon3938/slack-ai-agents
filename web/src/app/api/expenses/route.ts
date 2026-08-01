import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import {
  queryExpenses,
  queryExpensesByBillingMonth,
  createExpense,
  createInstallmentExpenses,
} from '@/features/budget/lib/queries';
import { ALL_EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/features/budget/lib/types';
import { getTodayISO } from '@/lib/kst';
import { validateFields } from '@/lib/validation';

const VALID_EXPENSE_CATEGORIES = new Set<string>(ALL_EXPENSE_CATEGORIES);
const VALID_INCOME_CATEGORIES = new Set<string>(INCOME_CATEGORIES);
const VALID_CATEGORIES = new Set<string>([...ALL_EXPENSE_CATEGORIES, ...INCOME_CATEGORIES]);

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
    const plannedExpenseId = searchParams.get('planned_expense_id');

    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return NextResponse.json(
        { error: 'from/to 날짜 형식이 올바르지 않습니다 (YYYY-MM-DD)' },
        { status: 400 },
      );
    }

    const data = await queryExpenses(
      userId,
      from,
      to,
      category,
      plannedExpenseId ? Number(plannedExpenseId) : undefined,
    );
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
    const body = (await request.json()) as {
      date?: string;
      amount?: number;
      category?: string;
      description?: string | null;
      payment_method?: string;
      memo?: string | null;
      type?: 'expense' | 'income';
      planned_expense_id?: number | null;
      installment_months?: number;
      exclude_from_budget?: boolean;
      distribute_to_budget?: boolean;
    };

    if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      return NextResponse.json({ error: 'date가 필요합니다 (YYYY-MM-DD)' }, { status: 400 });
    }
    if (typeof body.amount !== 'number' || body.amount <= 0 || !Number.isInteger(body.amount)) {
      return NextResponse.json({ error: 'amount는 양수 정수여야 합니다' }, { status: 400 });
    }

    const entryType = body.type ?? 'expense';
    if (entryType !== 'expense' && entryType !== 'income') {
      return NextResponse.json(
        { error: 'type은 expense 또는 income이어야 합니다' },
        { status: 400 },
      );
    }

    // 수입이면 수입 카테고리, 지출이면 지출 카테고리 검증
    const validSet = entryType === 'income' ? VALID_INCOME_CATEGORIES : VALID_EXPENSE_CATEGORIES;
    if (!body.category || !validSet.has(body.category)) {
      return NextResponse.json({ error: '유효하지 않은 category입니다' }, { status: 400 });
    }

    const lengthError = validateFields([
      [body.description, 'description'],
      [body.memo, 'memo'],
      [body.payment_method, 'paymentMethod'],
    ]);
    if (lengthError) {
      return NextResponse.json({ error: lengthError }, { status: 400 });
    }

    const excludeFromBudget =
      typeof body.exclude_from_budget === 'boolean' ? body.exclude_from_budget : false;

    // 할부 처리 (카드 2~12개월)
    // 예산 제외 카테고리(리커밋 사업 등)를 할부로 넣으면 클라이언트가 exclude 토글 값을 실어 보내는데,
    // 할부 행은 예외 없이 묶인 돈이라 그 조합을 저장할 수 없다 (#549). 여기서 값을 넘기지 않는다.
    const installmentMonths = body.installment_months ?? 1;
    if (installmentMonths >= 2 && installmentMonths <= 12) {
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
      distribute_to_budget: body.distribute_to_budget ?? false,
    });
    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    console.error('[Expense API]', request.url, err);
    return NextResponse.json({ error: '지출 추가 실패' }, { status: 500 });
  }
}
