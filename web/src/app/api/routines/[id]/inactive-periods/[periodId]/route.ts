import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { isISODate, parseRouteId } from '@/lib/validation';
import { updateInactivePeriod, deleteInactivePeriod } from '@/features/routine/lib/queries';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; periodId: string }> },
) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const periodId = parseRouteId((await params).periodId);
    if (periodId === null) return NextResponse.json({ error: '잘못된 ID' }, { status: 400 });

    const body = (await request.json()) as { start_date?: unknown; end_date?: unknown };
    if (!isISODate(body.start_date)) {
      return NextResponse.json({ error: 'start_date 필요 (YYYY-MM-DD)' }, { status: 400 });
    }
    const endDate = body.end_date ?? null;
    if (endDate !== null && !isISODate(endDate)) {
      return NextResponse.json({ error: 'end_date 형식 오류 (YYYY-MM-DD)' }, { status: 400 });
    }

    const data = await updateInactivePeriod(userId, periodId, body.start_date, endDate);
    if (!data) return NextResponse.json({ error: '비활성 기간을 찾을 수 없어' }, { status: 404 });
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: '비활성 기간 수정 실패' }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; periodId: string }> },
) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const periodId = parseRouteId((await params).periodId);
    if (periodId === null) return NextResponse.json({ error: '잘못된 ID' }, { status: 400 });

    const deleted = await deleteInactivePeriod(userId, periodId);
    if (!deleted) return NextResponse.json({ error: '비활성 기간을 찾을 수 없어' }, { status: 404 });
    return NextResponse.json({ data: { id: periodId } });
  } catch {
    return NextResponse.json({ error: '비활성 기간 삭제 실패' }, { status: 500 });
  }
}
