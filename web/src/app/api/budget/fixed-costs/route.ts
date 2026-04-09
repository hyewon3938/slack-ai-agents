import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { queryFixedCosts, createFixedCost } from '@/features/budget/lib/queries';

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
    const body = (await request.json()) as {
      name?: string;
      amount?: number;
      category?: string;
      day_of_month?: number | null;
    };

    if (!body.name?.trim()) {
      return NextResponse.json({ error: '이름을 입력해주세요' }, { status: 400 });
    }
    if (typeof body.amount !== 'number' || body.amount <= 0) {
      return NextResponse.json({ error: '금액은 양수여야 합니다' }, { status: 400 });
    }
    if (body.day_of_month != null && (body.day_of_month < 1 || body.day_of_month > 31)) {
      return NextResponse.json({ error: '결제일은 1~31 사이여야 합니다' }, { status: 400 });
    }

    const data = await createFixedCost(userId, {
      name: body.name.trim(),
      amount: body.amount,
      category: body.category,
      day_of_month: body.day_of_month,
    });

    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    console.error('[Budget API]', request.url, err);
    return NextResponse.json({ error: '고정비 생성 실패' }, { status: 500 });
  }
}
