import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getRunwayProjection } from '@/features/budget/lib/facade';

export const dynamic = 'force-dynamic';

export async function GET() {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const data = await getRunwayProjection(userId, new Date());
    return NextResponse.json({ data });
  } catch (err) {
    console.error('[Budget API] runway', err);
    return NextResponse.json({ error: '런웨이 조회 실패' }, { status: 500 });
  }
}
