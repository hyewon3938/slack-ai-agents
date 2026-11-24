import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { isISODate, parseRouteId } from '@/lib/validation';
import {
  queryInactivePeriods,
  createInactivePeriod,
  queryRoutineTemplate,
} from '@/features/routine/lib/queries';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const id = parseRouteId((await params).id);
    if (id === null) return NextResponse.json({ error: '잘못된 ID' }, { status: 400 });

    const data = await queryInactivePeriods(userId, id);
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: '비활성 기간 조회 실패' }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const id = parseRouteId((await params).id);
    if (id === null) return NextResponse.json({ error: '잘못된 ID' }, { status: 400 });

    const body = (await request.json()) as { start_date?: unknown; end_date?: unknown };
    if (!isISODate(body.start_date)) {
      return NextResponse.json({ error: 'start_date 필요 (YYYY-MM-DD)' }, { status: 400 });
    }
    const endDate = body.end_date ?? null;
    if (endDate !== null && !isISODate(endDate)) {
      return NextResponse.json({ error: 'end_date 형식 오류 (YYYY-MM-DD)' }, { status: 400 });
    }

    // 비활성 기간은 본인 루틴에만 붙인다
    const template = await queryRoutineTemplate(userId, id);
    if (!template) return NextResponse.json({ error: '루틴을 찾을 수 없어' }, { status: 404 });

    const data = await createInactivePeriod(userId, id, body.start_date, endDate);
    return NextResponse.json({ data }, { status: 201 });
  } catch {
    return NextResponse.json({ error: '비활성 기간 생성 실패' }, { status: 500 });
  }
}
