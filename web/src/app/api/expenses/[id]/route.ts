import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { updateExpense, deleteExpense } from '@/features/budget/lib/queries';
import { EXPENSE_CATEGORIES } from '@/lib/types';

const VALID_CATEGORIES = new Set<string>(EXPENSE_CATEGORIES);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id: rawId } = await params;
    const id = parseInt(rawId, 10);
    if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID' }, { status: 400 });

    const body = (await request.json()) as Record<string, unknown>;

    // 입력 검증
    if ('amount' in body && (typeof body.amount !== 'number' || body.amount <= 0)) {
      return NextResponse.json({ error: 'amount는 양수 숫자여야 합니다' }, { status: 400 });
    }
    if ('category' in body && typeof body.category === 'string' && !VALID_CATEGORIES.has(body.category)) {
      return NextResponse.json({ error: '유효하지 않은 category입니다' }, { status: 400 });
    }
    if ('date' in body && typeof body.date === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      return NextResponse.json({ error: 'date 형식이 올바르지 않습니다' }, { status: 400 });
    }

    const data = await updateExpense(userId, id, body);
    if (!data) return NextResponse.json({ error: '지출을 찾을 수 없습니다' }, { status: 404 });
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: '지출 수정 실패' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id: rawId } = await params;
    const id = parseInt(rawId, 10);
    if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID' }, { status: 400 });

    const deleted = await deleteExpense(userId, id);
    if (!deleted) return NextResponse.json({ error: '지출을 찾을 수 없습니다' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: '지출 삭제 실패' }, { status: 500 });
  }
}
