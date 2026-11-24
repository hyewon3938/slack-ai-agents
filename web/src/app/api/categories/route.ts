import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { VALID_CATEGORY_TYPES } from '@/lib/types';
import {
  createCategory,
  queryCategories,
  validateCategoryOwnership,
} from '@/features/schedule/lib/queries';
import { isPositiveId, validateFields } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function GET() {
  const userId = await requireAuth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const data = await queryCategories(userId);
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: '카테고리 조회 실패' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const userId = await requireAuth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      name?: unknown;
      color?: string;
      type?: string;
      parent_id?: unknown;
    };

    if (typeof body.name !== 'string' || !body.name.trim()) {
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

    const parentId = body.parent_id ?? null;
    if (parentId !== null) {
      if (!isPositiveId(parentId)) {
        return NextResponse.json({ error: '유효하지 않은 상위 카테고리' }, { status: 400 });
      }
      if (!(await validateCategoryOwnership(userId, parentId))) {
        return NextResponse.json({ error: '상위 카테고리를 찾을 수 없어' }, { status: 400 });
      }
    }

    const data = await createCategory(userId, {
      name: body.name.trim(),
      color: body.color,
      type: body.type,
      parent_id: parentId,
    });
    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (message.includes('duplicate') || message.includes('unique')) {
      return NextResponse.json({ error: '이미 있는 카테고리야' }, { status: 409 });
    }
    console.error('[categories] 생성 실패:', err);
    return NextResponse.json({ error: '카테고리 생성 실패' }, { status: 500 });
  }
}
