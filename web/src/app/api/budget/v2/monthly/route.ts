import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getMonthlyAllocation } from '@/features/budget/lib/facade';

export const dynamic = 'force-dynamic';

export async function GET() {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const data = await getMonthlyAllocation(userId, new Date());
    return NextResponse.json({ data });
  } catch (err) {
    console.error('[Budget v2 API] monthly', err);
    return NextResponse.json({ error: '월 예산 조회 실패' }, { status: 500 });
  }
}
