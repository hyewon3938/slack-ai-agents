import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import {
  createSchedule,
  validateCategoryOwnership,
  querySchedulesByRange,
  queryBacklogSchedules,
} from '@/features/schedule/lib/queries';
import { isValidStatus } from '@/features/schedule/lib/types';
import { validateFields } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const userId = await requireAuth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const backlog = searchParams.get('backlog');
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    if (backlog === 'true') {
      const data = await queryBacklogSchedules(userId);
      return NextResponse.json({ data });
    }

    if (from && to) {
      const data = await querySchedulesByRange(userId, from, to);
      return NextResponse.json({ data });
    }

    return NextResponse.json({ error: 'from/to 또는 backlog 파라미터 필요' }, { status: 400 });
  } catch {
    return NextResponse.json({ error: '일정 조회 실패' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const userId = await requireAuth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      title?: string;
      date?: string | null;
      end_date?: string | null;
      status?: string;
      category_id?: number | null;
      memo?: string | null;
      important?: boolean;
    };

    if (!body.title?.trim()) {
      return NextResponse.json({ error: '제목을 입력해줘' }, { status: 400 });
    }

    const lengthError = validateFields([
      [body.title, 'title'],
      [body.memo, 'memo'],
    ]);
    if (lengthError) {
      return NextResponse.json({ error: lengthError }, { status: 400 });
    }

    if (body.status !== undefined && !isValidStatus(body.status)) {
      return NextResponse.json({ error: '유효하지 않은 상태값이야' }, { status: 400 });
    }

    if (body.category_id != null) {
      if (!Number.isInteger(body.category_id) || body.category_id <= 0) {
        return NextResponse.json({ error: '카테고리 값이 잘못됐어' }, { status: 400 });
      }
      const ok = await validateCategoryOwnership(userId, body.category_id);
      if (!ok) {
        return NextResponse.json({ error: '카테고리를 찾을 수 없어' }, { status: 400 });
      }
    }

    const data = await createSchedule(userId, {
      title: body.title.trim(),
      date: body.date,
      end_date: body.end_date,
      status: body.status,
      category_id: body.category_id ?? null,
      memo: body.memo,
      important: body.important,
    });

    return NextResponse.json({ data }, { status: 201 });
  } catch {
    return NextResponse.json({ error: '일정 생성 실패' }, { status: 500 });
  }
}
