import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { requireAuth } from '@/lib/auth';
import { deleteRecordsBefore } from '@/features/routine/lib/queries';

/** 특정 날짜 이전의 완료된 기록 일괄 삭제 (시작일 변경 후 정리용) */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    const before = new URL(request.url).searchParams.get('before');
    if (!before || !/^\d{4}-\d{2}-\d{2}$/.test(before)) {
      return NextResponse.json({ error: 'before 파라미터(YYYY-MM-DD)가 필요해' }, { status: 400 });
    }

    const deleted = await deleteRecordsBefore(userId, Number(id), before, true);

    revalidateTag('routine-records', 'seconds');
    revalidateTag('routine-stats', 'seconds');
    return NextResponse.json({ data: { deleted } });
  } catch {
    return NextResponse.json({ error: '기록 삭제 실패' }, { status: 500 });
  }
}
