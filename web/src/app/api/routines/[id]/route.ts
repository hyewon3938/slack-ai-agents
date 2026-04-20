import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getTodayISO, addDays } from '@/lib/kst';
import { validateFields } from '@/lib/validation';
import {
  updateRoutineTemplate,
  deleteRoutineTemplate,
  createInactivePeriod,
  closeOpenInactivePeriod,
  queryRoutineTemplate,
  deleteRecordsBefore,
  countCompletedRecordsBefore,
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

    // 시작일 변경 감지를 위해 이전 값 미리 조회
    const oldTemplate = await queryRoutineTemplate(userId, numId);
    if (!oldTemplate) return NextResponse.json({ error: '루틴을 찾을 수 없어' }, { status: 404 });

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

    // 시작일이 미래로 이동된 경우 이전 기록 정리 (미완료만 자동, 완료는 카운트만 반환)
    let staleCompletedCount = 0;
    if (data.start_date && oldTemplate.start_date && data.start_date > oldTemplate.start_date) {
      await deleteRecordsBefore(userId, numId, data.start_date, false);
      staleCompletedCount = await countCompletedRecordsBefore(userId, numId, data.start_date);
    }

    return NextResponse.json({ data, staleCompletedCount });
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

    return NextResponse.json({ data: { id: Number(id) } });
  } catch {
    return NextResponse.json({ error: '루틴 삭제 실패' }, { status: 500 });
  }
}
