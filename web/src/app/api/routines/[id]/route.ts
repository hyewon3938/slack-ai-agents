import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { requireAuth } from '@/lib/auth';
import { getTodayISO, addDays } from '@/lib/kst';
import { validateFields } from '@/lib/validation';
import {
  updateRoutineTemplate,
  deleteRoutineTemplate,
  createInactivePeriod,
  closeOpenInactivePeriod,
} from '@/features/routine/lib/queries';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    const numId = Number(id);
    const body = (await request.json()) as Partial<{
      name: string;
      time_slot: string | null;
      frequency: string | null;
      active: boolean;
      start_date: string;
    }>;

    const lengthError = validateFields([
      [body.name, 'name'],
      [body.time_slot, 'timeSlot'],
      [body.frequency, 'frequency'],
    ]);
    if (lengthError) {
      return NextResponse.json({ error: lengthError }, { status: 400 });
    }

    const data = await updateRoutineTemplate(userId, numId, body);
    if (!data) return NextResponse.json({ error: '루틴을 찾을 수 없어' }, { status: 404 });

    // active 토글 시 비활성 기간 자동 관리
    if (body.active === false) {
      // 비활성화 → 오늘부터 비활성 기간 시작
      await createInactivePeriod(userId, numId, getTodayISO(), null);
    } else if (body.active === true) {
      // 재개 → 열린 비활성 기간을 어제로 종료
      await closeOpenInactivePeriod(userId, numId, addDays(getTodayISO(), -1));
    }

    revalidateTag('routines', 'seconds');
    revalidateTag('routine-records', 'seconds');
    revalidateTag('routine-stats', 'seconds');
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

    revalidateTag('routines', 'seconds');
    return NextResponse.json({ data: { id: Number(id) } });
  } catch {
    return NextResponse.json({ error: '루틴 삭제 실패' }, { status: 500 });
  }
}
