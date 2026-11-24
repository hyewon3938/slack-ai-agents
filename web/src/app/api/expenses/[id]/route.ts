import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import {
  updateExpense,
  deleteExpense,
  isPlannedExpenseOwned,
  FIXED_SOURCE_EXCLUDE_LOCKED,
} from '@/features/budget/lib/queries';
import { parseIdParam, validateExpenseFields } from '@/features/budget/lib/validate-input';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id: rawId } = await params;
    const id = parseIdParam(rawId);
    if (id === null) return NextResponse.json({ error: '잘못된 ID' }, { status: 400 });

    const raw = (await request.json()) as unknown;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return NextResponse.json({ error: '요청 본문이 올바르지 않습니다' }, { status: 400 });
    }
    const body = raw as Record<string, unknown>;

    // 보낸 필드만 POST와 같은 기준으로 검증한다
    const fieldError = validateExpenseFields(body, 'update');
    if (fieldError) {
      return NextResponse.json({ error: fieldError }, { status: 400 });
    }
    if (
      typeof body.planned_expense_id === 'number' &&
      !(await isPlannedExpenseOwned(userId, body.planned_expense_id))
    ) {
      return NextResponse.json({ error: '예정 지출을 찾을 수 없습니다' }, { status: 400 });
    }

    const data = await updateExpense(userId, id, body);
    if (!data) return NextResponse.json({ error: '지출을 찾을 수 없습니다' }, { status: 404 });
    return NextResponse.json({ data });
  } catch (err) {
    if (err instanceof Error && err.message === FIXED_SOURCE_EXCLUDE_LOCKED) {
      return NextResponse.json(
        { error: '자동 등록 고정비 항목은 예산 제외 설정을 변경할 수 없습니다' },
        { status: 400 },
      );
    }
    console.error('[Expense API]', request.url, err);
    return NextResponse.json({ error: '지출 수정 실패' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id: rawId } = await params;
    const id = parseIdParam(rawId);
    if (id === null) return NextResponse.json({ error: '잘못된 ID' }, { status: 400 });

    const deleted = await deleteExpense(userId, id);
    if (!deleted) return NextResponse.json({ error: '지출을 찾을 수 없습니다' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[Expense API]', request.url, err);
    return NextResponse.json({ error: '지출 삭제 실패' }, { status: 500 });
  }
}
