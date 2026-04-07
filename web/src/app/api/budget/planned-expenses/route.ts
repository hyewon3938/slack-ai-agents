import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { queryPlannedExpenses, createPlannedExpense, deletePlannedExpense } from '@/features/budget/lib/queries';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const yearMonth = searchParams.get('yearMonth') ?? undefined;
    const data = await queryPlannedExpenses(userId, yearMonth);
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: '예정 지출 조회 실패' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = (await request.json()) as { year_month?: string; amount?: number; memo?: string | null };
    const { year_month, amount, memo } = body;

    if (!year_month || !/^\d{4}-\d{2}$/.test(year_month)) {
      return NextResponse.json({ error: 'year_month 형식: YYYY-MM' }, { status: 400 });
    }
    if (typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json({ error: 'amount는 양수여야 합니다' }, { status: 400 });
    }

    const data = await createPlannedExpense(userId, { year_month, amount, memo: memo ?? null });
    return NextResponse.json({ data }, { status: 201 });
  } catch {
    return NextResponse.json({ error: '예정 지출 추가 실패' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const id = Number(searchParams.get('id'));
    if (!id || isNaN(id)) return NextResponse.json({ error: 'id 필수' }, { status: 400 });

    const deleted = await deletePlannedExpense(userId, id);
    if (!deleted) return NextResponse.json({ error: '항목을 찾을 수 없습니다' }, { status: 404 });
    return NextResponse.json({ data: { deleted: true } });
  } catch {
    return NextResponse.json({ error: '예정 지출 삭제 실패' }, { status: 500 });
  }
}
