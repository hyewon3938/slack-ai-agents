import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getCachedRoutineStats } from '@/lib/cache';

export async function GET(request: Request) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    if (!from || !to) {
      return NextResponse.json({ error: 'from/to 파라미터 필요' }, { status: 400 });
    }

    const data = await getCachedRoutineStats(userId, from, to);
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: '루틴 통계 조회 실패' }, { status: 500 });
  }
}
