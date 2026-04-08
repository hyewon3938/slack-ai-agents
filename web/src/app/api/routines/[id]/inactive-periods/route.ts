import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { requireAuth } from '@/lib/auth';
import { queryInactivePeriods, createInactivePeriod } from '@/features/routine/lib/queries';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    const data = await queryInactivePeriods(userId, Number(id));
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
    const { id } = await params;
    const body = (await request.json()) as { start_date?: string; end_date?: string | null };
    if (!body.start_date) {
      return NextResponse.json({ error: 'start_date 필요' }, { status: 400 });
    }
    const data = await createInactivePeriod(
      userId,
      Number(id),
      body.start_date,
      body.end_date ?? null,
    );
    revalidateTag('routine-stats', 'seconds');
    return NextResponse.json({ data }, { status: 201 });
  } catch {
    return NextResponse.json({ error: '비활성 기간 생성 실패' }, { status: 500 });
  }
}
