import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { queryRunway, queryTargetDate } from '@/features/budget/lib/queries';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    // 파라미터로 전달된 targetDate 우선, 없으면 DB에서 로드
    const paramTarget = searchParams.get('targetDate');
    const targetDate = paramTarget ?? (await queryTargetDate(userId)) ?? undefined;
    const data = await queryRunway(userId, targetDate);
    return NextResponse.json({ data });
  } catch (err) {
    console.error('[Budget API]', request.url, err);
    return NextResponse.json({ error: '런웨이 계산 실패' }, { status: 500 });
  }
}
