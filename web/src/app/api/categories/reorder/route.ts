import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { requireAuth } from '@/lib/auth';
import { reorderCategories } from '@/features/schedule/lib/queries';

export async function POST(request: Request) {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as { orders?: { id: number; sort_order: number }[] };

    if (!Array.isArray(body.orders) || body.orders.length === 0) {
      return NextResponse.json({ error: '순서 데이터가 필요해' }, { status: 400 });
    }

    for (const item of body.orders) {
      if (typeof item.id !== 'number' || typeof item.sort_order !== 'number' || !Number.isFinite(item.id) || !Number.isFinite(item.sort_order)) {
        return NextResponse.json({ error: '잘못된 순서 데이터' }, { status: 400 });
      }
    }

    await reorderCategories(body.orders);
    revalidateTag('categories', 'seconds');
    return NextResponse.json({ data: { ok: true } });
  } catch {
    return NextResponse.json({ error: '순서 변경 실패' }, { status: 500 });
  }
}
