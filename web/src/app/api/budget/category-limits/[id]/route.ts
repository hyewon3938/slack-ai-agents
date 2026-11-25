import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import {
  updateCategoryLimit,
  deleteCategoryLimit,
} from '@/features/budget/lib/repository/category-limits-repo';
import { isValidTargetCount, parseIdParam } from '@/features/budget/lib/validate-input';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id: idStr } = await params;
    const id = parseIdParam(idStr);
    if (id === null) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const body = (await request.json()) as { target_count?: unknown };
    if (!isValidTargetCount(body.target_count)) {
      return NextResponse.json({ error: '한도는 1~50 사이 정수여야 해' }, { status: 400 });
    }
    const data = await updateCategoryLimit(userId, id, { target_count: body.target_count });
    if (!data) return NextResponse.json({ error: '한도를 찾을 수 없어' }, { status: 404 });
    return NextResponse.json({ data });
  } catch (err) {
    console.error('[Budget API] category-limits PATCH', err);
    return NextResponse.json({ error: '한도 수정 실패' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id: idStr } = await params;
    const id = parseIdParam(idStr);
    if (id === null) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const deleted = await deleteCategoryLimit(userId, id);
    if (!deleted) return NextResponse.json({ error: '한도를 찾을 수 없어' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[Budget API] category-limits DELETE', err);
    return NextResponse.json({ error: '한도 삭제 실패' }, { status: 500 });
  }
}
