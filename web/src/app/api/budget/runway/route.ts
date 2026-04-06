import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { queryRunway } from '@/features/budget/lib/queries';

export const dynamic = 'force-dynamic';

export async function GET() {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const data = await queryRunway(userId);
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: '런웨이 계산 실패' }, { status: 500 });
  }
}
