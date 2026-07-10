import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { deleteSleepEvent } from '@/features/sleep/lib/queries';

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id: rawId } = await params;
    const id = parseInt(rawId, 10);
    if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID' }, { status: 400 });

    const deleted = await deleteSleepEvent(userId, id);
    if (!deleted)
      return NextResponse.json({ error: '수면 이벤트를 찾을 수 없습니다' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Sleep API]', request.url, err);
    return NextResponse.json({ error: '수면 이벤트 삭제 실패' }, { status: 500 });
  }
}
