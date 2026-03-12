import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { requireAuth } from '@/lib/auth';
import {
  queryScheduleById,
  updateSchedule,
  deleteSchedule,
  ensureCategoryExists,
} from '@/features/schedule/lib/queries';
import { isValidStatus } from '@/lib/types';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const data = await queryScheduleById(Number(id));
    if (!data) {
      return NextResponse.json({ error: '일정을 찾을 수 없어' }, { status: 404 });
    }
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: '일정 조회 실패' }, { status: 500 });
  }
}

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
      title: string;
      date: string | null;
      end_date: string | null;
      status: string;
      category: string | null;
      memo: string | null;
      important: boolean;
    }>;

    if (body.status !== undefined && !isValidStatus(body.status)) {
      return NextResponse.json({ error: '유효하지 않은 상태값이야' }, { status: 400 });
    }

    if (body.category) {
      await ensureCategoryExists(body.category);
    }

    const data = await updateSchedule(Number(id), body);
    if (!data) {
      return NextResponse.json({ error: '일정을 찾을 수 없어' }, { status: 404 });
    }
    revalidateTag('schedules', 'seconds');
    if (body.category) revalidateTag('categories', 'seconds');
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: '일정 수정 실패' }, { status: 500 });
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
    const deleted = await deleteSchedule(Number(id));
    if (!deleted) {
      return NextResponse.json({ error: '일정을 찾을 수 없어' }, { status: 404 });
    }
    revalidateTag('schedules', 'seconds');
    return NextResponse.json({ data: { id: Number(id) } });
  } catch {
    return NextResponse.json({ error: '일정 삭제 실패' }, { status: 500 });
  }
}
