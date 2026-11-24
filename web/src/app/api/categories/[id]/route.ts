import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { requireAuth } from '@/lib/auth';
import { VALID_CATEGORY_TYPES } from '@/lib/types';
import { updateCategory, deleteCategory } from '@/features/schedule/lib/queries';
import { parseRouteId, validateFields } from '@/lib/validation';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requireAuth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const id = parseRouteId((await params).id);
    if (id === null) return NextResponse.json({ error: '잘못된 ID' }, { status: 400 });

    const body = (await request.json()) as Partial<{
      name: unknown;
      color: string;
      type: string;
      sort_order: number;
    }>;

    if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) {
      return NextResponse.json({ error: '이름을 입력해줘' }, { status: 400 });
    }
    const lengthError = validateFields([
      [body.name, 'name'],
      [body.color, 'color'],
    ]);
    if (lengthError) {
      return NextResponse.json({ error: lengthError }, { status: 400 });
    }
    if (
      body.type !== undefined &&
      (typeof body.type !== 'string' || !VALID_CATEGORY_TYPES.has(body.type))
    ) {
      return NextResponse.json({ error: '유효하지 않은 카테고리 유형' }, { status: 400 });
    }

    const data = await updateCategory(userId, id, {
      ...body,
      name: typeof body.name === 'string' ? body.name.trim() : undefined,
    });
    if (!data) {
      return NextResponse.json({ error: '카테고리를 찾을 수 없어' }, { status: 404 });
    }
    revalidateTag('categories', 'seconds');
    return NextResponse.json({ data });
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (message.includes('duplicate') || message.includes('unique')) {
      return NextResponse.json({ error: '이미 있는 이름이야' }, { status: 409 });
    }
    console.error('[categories] 수정 실패:', err);
    return NextResponse.json({ error: '카테고리 수정 실패' }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requireAuth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const id = parseRouteId((await params).id);
    if (id === null) return NextResponse.json({ error: '잘못된 ID' }, { status: 400 });

    const deleted = await deleteCategory(userId, id);
    if (!deleted) {
      return NextResponse.json({ error: '카테고리를 찾을 수 없어' }, { status: 404 });
    }
    revalidateTag('categories', 'seconds');
    return NextResponse.json({ data: { id } });
  } catch {
    return NextResponse.json({ error: '카테고리 삭제 실패' }, { status: 500 });
  }
}
