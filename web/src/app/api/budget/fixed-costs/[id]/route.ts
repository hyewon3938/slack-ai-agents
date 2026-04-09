import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { updateFixedCost, deleteFixedCost } from '@/features/budget/lib/queries';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id: idStr } = await params;
    const id = Number(idStr);
    if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const body = (await request.json()) as Record<string, unknown>;
    const data = await updateFixedCost(userId, id, body);
    if (!data) return NextResponse.json({ error: '고정비를 찾을 수 없습니다' }, { status: 404 });

    return NextResponse.json({ data });
  } catch (err) {
    console.error('[Budget API]', request.url, err);
    return NextResponse.json({ error: '고정비 수정 실패' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id: idStr } = await params;
    const id = Number(idStr);
    if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const deleted = await deleteFixedCost(userId, id);
    if (!deleted) return NextResponse.json({ error: '고정비를 찾을 수 없습니다' }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[Budget API]', request.url, err);
    return NextResponse.json({ error: '고정비 삭제 실패' }, { status: 500 });
  }
}
