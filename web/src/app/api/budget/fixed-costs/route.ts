import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { queryFixedCosts } from '@/features/budget/lib/queries';

export async function GET() {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const data = await queryFixedCosts(userId);
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: '고정비 조회 실패' }, { status: 500 });
  }
}
