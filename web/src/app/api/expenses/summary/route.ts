import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { queryMonthSummary } from '@/features/budget/lib/queries';

export async function GET(request: Request) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const yearMonth = searchParams.get('yearMonth') ?? new Date().toISOString().slice(0, 7);

    if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
      return NextResponse.json({ error: 'yearMonth 형식이 올바르지 않습니다 (YYYY-MM)' }, { status: 400 });
    }

    const data = await queryMonthSummary(userId, yearMonth);
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: '요약 조회 실패' }, { status: 500 });
  }
}
