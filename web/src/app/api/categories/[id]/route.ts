import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { requireAuth } from '@/lib/auth';
import { updateCategory, deleteCategory } from '@/features/schedule/lib/queries';

const VALID_CATEGORY_TYPES = new Set(['task', 'event']);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = (await request.json()) as Partial<{
      name: string;
      color: string;
      type: string;
      sort_order: number;
    }>;

    if (body.type && !VALID_CATEGORY_TYPES.has(body.type)) {
      return NextResponse.json({ error: '유효하지 않은 카테고리 유형' }, { status: 400 });
    }

    const data = await updateCategory(Number(id), body);
    if (!data) {
      return NextResponse.json({ error: '카테고리를 찾을 수 없어' }, { status: 404 });
    }
    revalidateTag('categories', 'seconds');
    return NextResponse.json({ data });
  } catch (err) {
    const message = err instanceof Error ? err.message : '카테고리 수정 실패';
    const isDuplicate = message.includes('duplicate') || message.includes('unique');
    return NextResponse.json(
      { error: isDuplicate ? '이미 있는 이름이야' : message },
      { status: isDuplicate ? 409 : 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const deleted = await deleteCategory(Number(id));
    if (!deleted) {
      return NextResponse.json({ error: '카테고리를 찾을 수 없어' }, { status: 404 });
    }
    revalidateTag('categories', 'seconds');
    return NextResponse.json({ data: { id: Number(id) } });
  } catch {
    return NextResponse.json({ error: '카테고리 삭제 실패' }, { status: 500 });
  }
}
