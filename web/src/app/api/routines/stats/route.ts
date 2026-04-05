import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getCachedRoutineStats } from '@/lib/cache';
import { queryRoutinePerStats } from '@/features/routine/lib/queries';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const type = searchParams.get('type');

    if (type === 'per-routine') {
      const data = await queryRoutinePerStats(
        userId,
        from ?? undefined,
        to ?? undefined,
      );
      return NextResponse.json({ data }, {
        headers: { 'Cache-Control': 'no-store, max-age=0' },
      });
    }

    if (!from || !to) {
      return NextResponse.json({ error: 'from/to 파라미터 필요' }, { status: 400 });
    }

    const data = await getCachedRoutineStats(userId, from, to);
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: '루틴 통계 조회 실패' }, { status: 500 });
  }
}
