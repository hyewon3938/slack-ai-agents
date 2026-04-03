import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { requireAuth } from '@/lib/auth';
import { updateRoutineTemplate, deleteRoutineTemplate } from '@/features/routine/lib/queries';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    const body = (await request.json()) as Partial<{
      name: string;
      time_slot: string | null;
      frequency: string | null;
      active: boolean;
    }>;

    const data = await updateRoutineTemplate(userId, Number(id), body);
    if (!data) return NextResponse.json({ error: '루틴을 찾을 수 없어' }, { status: 404 });

    revalidateTag('routines');
    revalidateTag('routine-records');
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: '루틴 수정 실패' }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    const deleted = await deleteRoutineTemplate(userId, Number(id));
    if (!deleted) return NextResponse.json({ error: '루틴을 찾을 수 없어' }, { status: 404 });

    revalidateTag('routines');
    return NextResponse.json({ data: { id: Number(id) } });
  } catch {
    return NextResponse.json({ error: '루틴 삭제 실패' }, { status: 500 });
  }
}
