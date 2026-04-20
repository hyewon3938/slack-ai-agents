import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { ensureTodayRecords, queryRoutineRecords } from '@/features/routine/lib/queries';
import { getTodayISO } from '@/lib/kst';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');
    if (!date) return NextResponse.json({ error: 'date 파라미터 필요' }, { status: 400 });

    if (date === getTodayISO()) {
      await ensureTodayRecords(userId, date);
    }

    const data = await queryRoutineRecords(userId, date);
    return NextResponse.json(
      { data },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  } catch {
    return NextResponse.json({ error: '루틴 기록 조회 실패' }, { status: 500 });
  }
}
