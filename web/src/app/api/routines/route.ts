import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import {
  createRoutineTemplate,
  backfillRecords,
  queryRoutineTemplates,
} from '@/features/routine/lib/queries';
import type { RoutineTrackingMode } from '@/features/routine/lib/types';
import { getTodayISO } from '@/lib/kst';
import { validateFields } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/** 추적 모드 허용값 — 자유 TEXT가 아니므로 화이트리스트로 검증 (ADR-0061) */
const TRACKING_MODES: readonly string[] = ['scheduled', 'free'];

export async function GET() {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const data = await queryRoutineTemplates(userId);
    return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
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
      tracking_mode?: RoutineTrackingMode;
    };

    if (!body.name?.trim()) {
      return NextResponse.json({ error: '루틴 이름을 입력해줘' }, { status: 400 });
    }
    const lengthError = validateFields([
      [body.name, 'name'],
      [body.time_slot, 'timeSlot'],
      [body.frequency, 'frequency'],
    ]);
    if (lengthError) {
      return NextResponse.json({ error: lengthError }, { status: 400 });
    }
    if (body.start_date && !/^\d{4}-\d{2}-\d{2}$/.test(body.start_date)) {
      return NextResponse.json(
        { error: 'start_date 형식이 올바르지 않습니다 (YYYY-MM-DD)' },
        { status: 400 },
      );
    }
    if (body.tracking_mode !== undefined && !TRACKING_MODES.includes(body.tracking_mode)) {
      return NextResponse.json({ error: 'tracking_mode 값 오류' }, { status: 400 });
    }

    const data = await createRoutineTemplate(userId, {
      name: body.name.trim(),
      time_slot: body.time_slot ?? null,
      frequency: body.frequency ?? null,
      start_date: body.start_date,
      tracking_mode: body.tracking_mode,
    });

    // 과거 start_date인 경우 빈도에 맞는 기록 백필
    // 자율 루틴은 기대된 발생이 없으므로 백필하지 않는다 (ADR-0061)
    if (body.tracking_mode !== 'free' && body.start_date) {
      const today = getTodayISO();
      await backfillRecords(userId, data.id, body.start_date, body.frequency ?? null, today);
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch {
    return NextResponse.json({ error: '루틴 생성 실패' }, { status: 500 });
  }
}
