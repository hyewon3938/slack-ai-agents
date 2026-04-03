import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { requireAuth } from '@/lib/auth';
import { toggleRoutineRecord, updateRoutineRecordMemo } from '@/features/routine/lib/queries';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    const body = (await request.json()) as Partial<{
      completed: boolean;
      memo: string | null;
    }>;

    if (body.completed !== undefined) {
      await toggleRoutineRecord(userId, Number(id), body.completed);
    }
    if (body.memo !== undefined) {
      await updateRoutineRecordMemo(userId, Number(id), body.memo);
    }

    revalidateTag('routine-records');
    revalidateTag('routine-stats');
    return NextResponse.json({ data: { id: Number(id) } });
  } catch {
    return NextResponse.json({ error: '루틴 기록 수정 실패' }, { status: 500 });
  }
}
