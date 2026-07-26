import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import {
  deleteFreeRecord,
  toggleRoutineRecord,
  updateRoutineRecordMemo,
} from '@/features/routine/lib/queries';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

    return NextResponse.json({ data: { id: Number(id) } });
  } catch {
    return NextResponse.json({ error: '루틴 기록 수정 실패' }, { status: 500 });
  }
}

/** 자율 기록 삭제 (오기록 회수) — 주기형 기록은 측정 기반이라 삭제 대상 아님 (ADR-0061) */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    const deleted = await deleteFreeRecord(userId, Number(id));
    if (!deleted) return NextResponse.json({ error: '자율 기록을 찾을 수 없어' }, { status: 404 });

    return NextResponse.json({ data: { id: Number(id) } });
  } catch {
    return NextResponse.json({ error: '자율 기록 삭제 실패' }, { status: 500 });
  }
}
