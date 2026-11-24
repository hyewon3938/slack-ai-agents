import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { queryFixedCosts, createFixedCost } from '@/features/budget/lib/queries';
import { parseFixedCostCreate } from '@/features/budget/lib/validate-input';

export async function GET(request: Request) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const data = await queryFixedCosts(userId);
    return NextResponse.json({ data });
  } catch (err) {
    console.error('[Budget API]', request.url, err);
    return NextResponse.json({ error: '고정비 조회 실패' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const parsed = parseFixedCostCreate(await request.json());
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const data = await createFixedCost(userId, parsed.data);

    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    console.error('[Budget API]', request.url, err);
    return NextResponse.json({ error: '고정비 생성 실패' }, { status: 500 });
  }
}
