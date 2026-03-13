import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { requireAuth } from '@/lib/auth';
import { createCategory } from '@/features/schedule/lib/queries';
import { getCachedCategories } from '@/lib/cache';

const VALID_CATEGORY_TYPES = new Set(['task', 'event']);

export async function GET() {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const data = await getCachedCategories();
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: '카테고리 조회 실패' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as { name?: string; color?: string; type?: string };

    if (!body.name?.trim()) {
      return NextResponse.json({ error: '이름을 입력해줘' }, { status: 400 });
    }
    if (body.type && !VALID_CATEGORY_TYPES.has(body.type)) {
      return NextResponse.json({ error: '유효하지 않은 카테고리 유형' }, { status: 400 });
    }

    const data = await createCategory({
      name: body.name.trim(),
      color: body.color,
      type: body.type,
    });
    revalidateTag('categories', 'seconds');
    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : '카테고리 생성 실패';
    const isDuplicate = message.includes('duplicate') || message.includes('unique');
    return NextResponse.json(
      { error: isDuplicate ? '이미 있는 카테고리야' : message },
      { status: isDuplicate ? 409 : 500 },
    );
  }
}
