import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getTodayISO } from '@/lib/kst';
import { parseRouteId } from '@/lib/validation';
import { queryRoutineHeatmap } from '@/features/routine/lib/queries';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const id = parseRouteId((await params).id);
    if (id === null) return NextResponse.json({ error: '잘못된 ID' }, { status: 400 });

    // 기본값은 KST 오늘 기준 (서버 TZ와 무관)
    const [todayYear, todayMonth] = getTodayISO().split('-').map(Number);
    const { searchParams } = new URL(request.url);
    const year = Number(searchParams.get('year') ?? todayYear);
    const month = Number(searchParams.get('month') ?? todayMonth);
    if (!Number.isInteger(year) || year < 1900 || year > 9999) {
      return NextResponse.json({ error: 'year 값 오류' }, { status: 400 });
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: 'month 값 오류' }, { status: 400 });
    }

    const data = await queryRoutineHeatmap(userId, id, year, month);
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: '히트맵 조회 실패' }, { status: 500 });
  }
}
