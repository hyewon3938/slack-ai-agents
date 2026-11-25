import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { updateFixedCost, deleteFixedCost } from '@/features/budget/lib/queries';
import { parseFixedCostUpdate, parseIdParam } from '@/features/budget/lib/validate-input';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id: idStr } = await params;
    const id = parseIdParam(idStr);
    if (id === null) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    // 고정비 POST와 같은 기준으로 보낸 필드만 검증하고, 허용 필드만 넘긴다
    const parsed = parseFixedCostUpdate(await request.json());
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const data = await updateFixedCost(userId, id, parsed.data);
    if (!data) return NextResponse.json({ error: '고정비를 찾을 수 없습니다' }, { status: 404 });

    return NextResponse.json({ data });
  } catch (err) {
    console.error('[Budget API]', request.url, err);
    return NextResponse.json({ error: '고정비 수정 실패' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id: idStr } = await params;
    const id = parseIdParam(idStr);
    if (id === null) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const deleted = await deleteFixedCost(userId, id);
    if (!deleted) return NextResponse.json({ error: '고정비를 찾을 수 없습니다' }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[Budget API]', request.url, err);
    return NextResponse.json({ error: '고정비 삭제 실패' }, { status: 500 });
  }
}
