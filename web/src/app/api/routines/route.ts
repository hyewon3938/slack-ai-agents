import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { requireAuth } from '@/lib/auth';
import { getCachedRoutineTemplates } from '@/lib/cache';
import { createRoutineTemplate, backfillRecords } from '@/features/routine/lib/queries';
import { getTodayISO } from '@/lib/kst';

export async function GET() {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const data = await getCachedRoutineTemplates(userId);
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: '루틴 조회 실패' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = (await request.json()) as {
      name?: string;
      time_slot?: string | null;
      frequency?: string | null;
      start_date?: string;
    };

    if (!body.name?.trim()) {
      return NextResponse.json({ error: '루틴 이름을 입력해줘' }, { status: 400 });
    }
    if (body.start_date && !/^\d{4}-\d{2}-\d{2}$/.test(body.start_date)) {
      return NextResponse.json({ error: 'start_date 형식이 올바르지 않습니다 (YYYY-MM-DD)' }, { status: 400 });
    }

    const data = await createRoutineTemplate(userId, {
      name: body.name.trim(),
      time_slot: body.time_slot ?? null,
      frequency: body.frequency ?? null,
      start_date: body.start_date,
    });

    // 과거 start_date인 경우 빈도에 맞는 기록 백필
    if (body.start_date) {
      const today = getTodayISO();
      await backfillRecords(userId, data.id, body.start_date, body.frequency ?? null, today);
    }

    revalidateTag('routines', 'seconds');
    return NextResponse.json({ data }, { status: 201 });
  } catch {
    return NextResponse.json({ error: '루틴 생성 실패' }, { status: 500 });
  }
}
