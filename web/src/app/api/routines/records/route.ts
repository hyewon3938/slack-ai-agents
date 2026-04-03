import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { requireAuth } from '@/lib/auth';
import { getCachedRoutineRecords } from '@/lib/cache';
import { ensureTodayRecords } from '@/features/routine/lib/queries';
import { getTodayISO } from '@/lib/kst';

export async function GET(request: Request) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');
    if (!date) return NextResponse.json({ error: 'date 파라미터 필요' }, { status: 400 });

    if (date === getTodayISO()) {
      const created = await ensureTodayRecords(userId, date);
      if (created > 0) revalidateTag('routine-records');
    }

    const data = await getCachedRoutineRecords(userId, date);
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: '루틴 기록 조회 실패' }, { status: 500 });
  }
}
