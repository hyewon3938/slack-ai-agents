import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { queryBudget, upsertBudget } from '@/features/budget/lib/queries';
import { getTodayISO } from '@/lib/kst';

export async function GET(request: Request) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const yearMonth = searchParams.get('yearMonth') ?? getTodayISO().slice(0, 7);

    if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
      return NextResponse.json({ error: 'yearMonth 형식이 올바르지 않습니다 (YYYY-MM)' }, { status: 400 });
    }

    const data = await queryBudget(userId, yearMonth);
    return NextResponse.json({ data });
  } catch (err) {
    console.error('[Budget API]', request.url, err);
    return NextResponse.json({ error: '예산 조회 실패' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = (await request.json()) as {
      year_month?: string;
      total_budget?: number | null;
      daily_budget?: number | null;
      notes?: string | null;
    };

    if (!body.year_month || !/^\d{4}-\d{2}$/.test(body.year_month)) {
      return NextResponse.json({ error: 'year_month가 필요합니다 (YYYY-MM)' }, { status: 400 });
    }
    if (body.total_budget !== undefined && body.total_budget !== null && body.total_budget < 0) {
      return NextResponse.json({ error: 'total_budget은 0 이상이어야 합니다' }, { status: 400 });
    }
    if (body.daily_budget !== undefined && body.daily_budget !== null && body.daily_budget < 0) {
      return NextResponse.json({ error: 'daily_budget은 0 이상이어야 합니다' }, { status: 400 });
    }

    const data = await upsertBudget(userId, body.year_month, {
      total_budget: body.total_budget,
      daily_budget: body.daily_budget,
      notes: body.notes,
    });
    return NextResponse.json({ data });
  } catch (err) {
    console.error('[Budget API]', request.url, err);
    return NextResponse.json({ error: '예산 설정 실패' }, { status: 500 });
  }
}
