import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { queryRoutineHeatmap } from '@/features/routine/lib/queries';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const year = Number(searchParams.get('year') ?? new Date().getFullYear());
    const month = Number(searchParams.get('month') ?? new Date().getMonth() + 1);

    const data = await queryRoutineHeatmap(userId, Number(id), year, month);
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: '히트맵 조회 실패' }, { status: 500 });
  }
}
