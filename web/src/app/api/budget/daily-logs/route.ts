import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { queryDailyBudgetLogs } from '@/features/budget/lib/queries';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const yearMonth = searchParams.get('yearMonth');
  if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
    return NextResponse.json({ error: 'yearMonth 필수 (YYYY-MM)' }, { status: 400 });
  }

  try {
    const data = await queryDailyBudgetLogs(userId, yearMonth);
    return NextResponse.json({ data });
  } catch (err) {
    console.error('[Budget API]', request.url, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '조회 실패' },
      { status: 500 },
    );
  }
}
