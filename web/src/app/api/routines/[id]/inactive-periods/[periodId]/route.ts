import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { requireAuth } from '@/lib/auth';
import { updateInactivePeriod, deleteInactivePeriod } from '@/features/routine/lib/queries';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; periodId: string }> },
) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { periodId } = await params;
    const body = (await request.json()) as { start_date?: string; end_date?: string | null };
    if (!body.start_date) {
      return NextResponse.json({ error: 'start_date 필요' }, { status: 400 });
    }
    const data = await updateInactivePeriod(
      userId,
      Number(periodId),
      body.start_date,
      body.end_date ?? null,
    );
    if (!data) return NextResponse.json({ error: '비활성 기간을 찾을 수 없어' }, { status: 404 });
    revalidateTag('routine-stats', 'seconds');
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
    const { periodId } = await params;
    const deleted = await deleteInactivePeriod(userId, Number(periodId));
    if (!deleted) return NextResponse.json({ error: '비활성 기간을 찾을 수 없어' }, { status: 404 });
    revalidateTag('routine-stats', 'seconds');
    return NextResponse.json({ data: { id: Number(periodId) } });
  } catch {
    return NextResponse.json({ error: '비활성 기간 삭제 실패' }, { status: 500 });
  }
}
