import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { queryExpenses, createExpense } from '@/features/budget/lib/queries';
import { EXPENSE_CATEGORIES } from '@/lib/types';

const VALID_CATEGORIES = new Set<string>(EXPENSE_CATEGORIES);

export async function GET(request: Request) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from') ?? new Date().toISOString().slice(0, 7) + '-01';
    const to = searchParams.get('to') ?? new Date().toISOString().slice(0, 10);
    const category = searchParams.get('category') ?? undefined;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return NextResponse.json({ error: 'from/to 날짜 형식이 올바르지 않습니다 (YYYY-MM-DD)' }, { status: 400 });
    }
    if (category && !VALID_CATEGORIES.has(category)) {
      return NextResponse.json({ error: '유효하지 않은 category입니다' }, { status: 400 });
    }

    const data = await queryExpenses(userId, from, to, category);
    return NextResponse.json({ data });
  } catch {
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
    };

    if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      return NextResponse.json({ error: 'date가 필요합니다 (YYYY-MM-DD)' }, { status: 400 });
    }
    if (typeof body.amount !== 'number' || body.amount <= 0 || !Number.isInteger(body.amount)) {
      return NextResponse.json({ error: 'amount는 양수 정수여야 합니다' }, { status: 400 });
    }
    if (!body.category || !VALID_CATEGORIES.has(body.category)) {
      return NextResponse.json({ error: '유효하지 않은 category입니다' }, { status: 400 });
    }

    const data = await createExpense(userId, {
      date: body.date,
      amount: body.amount,
      category: body.category,
      description: body.description,
      payment_method: body.payment_method,
      memo: body.memo,
    });
    return NextResponse.json({ data }, { status: 201 });
  } catch {
    return NextResponse.json({ error: '지출 추가 실패' }, { status: 500 });
  }
}
