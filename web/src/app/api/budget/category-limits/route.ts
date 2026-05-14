import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import {
  readCategoryLimitsWithUsage,
  createCategoryLimit,
} from '@/features/budget/lib/repository/category-limits-repo';
import { getCurrentBillingMonth } from '@/features/budget/lib/billing/cycle';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const billingMonth = searchParams.get('billingMonth') ?? getCurrentBillingMonth(new Date());
    if (!/^\d{4}-\d{2}$/.test(billingMonth)) {
      return NextResponse.json({ error: 'billingMonth 형식: YYYY-MM' }, { status: 400 });
    }
    const data = await readCategoryLimitsWithUsage(userId, billingMonth);
    return NextResponse.json({ data });
  } catch (err) {
    console.error('[Budget API] category-limits GET', err);
    return NextResponse.json({ error: '한도 조회 실패' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = (await request.json()) as { category?: string; target_count?: number };
    const category = body.category?.trim();
    if (!category) return NextResponse.json({ error: '카테고리를 선택해줘' }, { status: 400 });
    if (typeof body.target_count !== 'number' || body.target_count < 1 || body.target_count > 50) {
      return NextResponse.json({ error: '한도는 1~50 사이여야 해' }, { status: 400 });
    }
    const data = await createCategoryLimit(userId, { category, target_count: body.target_count });
    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : '한도 생성 실패';
    const isDuplicate = message.includes('duplicate') || message.includes('unique');
    return NextResponse.json(
      { error: isDuplicate ? '이미 한도가 있는 카테고리야' : '한도 생성 실패' },
      { status: isDuplicate ? 409 : 500 },
    );
  }
}
