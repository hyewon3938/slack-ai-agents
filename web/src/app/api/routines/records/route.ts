import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import {
  createFreeRecord,
  ensureTodayRecords,
  queryRoutineRecords,
} from '@/features/routine/lib/queries';
import { getTodayISO } from '@/lib/kst';
import { validateFields } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');
    if (!date) return NextResponse.json({ error: 'date 파라미터 필요' }, { status: 400 });

    if (date === getTodayISO()) {
      await ensureTodayRecords(userId, date);
    }

    const data = await queryRoutineRecords(userId, date);
    return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch {
    return NextResponse.json({ error: '루틴 기록 조회 실패' }, { status: 500 });
  }
}

/** 자율 기록 생성 — 수행한 시점에만 남기는 기록 (ADR-0061) */
export async function POST(request: Request) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = (await request.json()) as Partial<{
      template_id: number;
      date: string;
      memo: string | null;
    }>;

    if (typeof body.template_id !== 'number') {
      return NextResponse.json({ error: 'template_id 필요' }, { status: 400 });
    }
    if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      return NextResponse.json({ error: 'date 형식 오류 (YYYY-MM-DD)' }, { status: 400 });
    }
    if (body.date > getTodayISO()) {
      return NextResponse.json({ error: '미래 날짜에는 기록할 수 없어' }, { status: 400 });
    }
    const lengthError = validateFields([[body.memo, 'memo']]);
    if (lengthError) return NextResponse.json({ error: lengthError }, { status: 400 });

    const data = await createFreeRecord(userId, body.template_id, body.date, body.memo ?? null);
    if (!data) {
      return NextResponse.json({ error: '자율 루틴이 아니거나 찾을 수 없어' }, { status: 400 });
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch {
    return NextResponse.json({ error: '자율 기록 생성 실패' }, { status: 500 });
  }
}
