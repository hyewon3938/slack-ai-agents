import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import {
  queryScheduleById,
  updateSchedule,
  deleteSchedule,
  recordDeleteReason,
  validateCategoryOwnership,
} from '@/features/schedule/lib/queries';
import { isValidStatus } from '@/features/schedule/lib/types';
import { isDeleteReasonCategory, type DeleteReason } from '@/features/schedule/lib/delete-reasons';
import { validateFields } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireAuth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const data = await queryScheduleById(userId, Number(id));
    if (!data) {
      return NextResponse.json({ error: '일정을 찾을 수 없어' }, { status: 404 });
    }
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: '일정 조회 실패' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireAuth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = (await request.json()) as Partial<{
      title: string;
      date: string | null;
      end_date: string | null;
      status: string;
      category_id: number | null;
      memo: string | null;
      important: boolean;
    }>;

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

    const data = await updateSchedule(userId, Number(id), body);
    if (!data) {
      return NextResponse.json({ error: '일정을 찾을 수 없어' }, { status: 404 });
    }
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: '일정 수정 실패' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireAuth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;

    // 삭제 사유 (선택 body) — 카테고리는 고정 어휘, 텍스트는 길이 제한 (#590)
    let reason: DeleteReason | null = null;
    const body = (await request.json().catch(() => null)) as {
      reason_category?: unknown;
      reason_text?: unknown;
    } | null;
    if (body?.reason_category !== undefined) {
      if (!isDeleteReasonCategory(body.reason_category)) {
        return NextResponse.json({ error: '삭제 사유 값이 잘못됐어' }, { status: 400 });
      }
      const text =
        typeof body.reason_text === 'string' && body.reason_text.trim()
          ? body.reason_text.trim()
          : null;
      const lengthError = validateFields([[text ?? undefined, 'reason']]);
      if (lengthError) {
        return NextResponse.json({ error: lengthError }, { status: 400 });
      }
      reason = { category: body.reason_category, text };
    }

    const deleted = await deleteSchedule(userId, Number(id));
    if (!deleted) {
      return NextResponse.json({ error: '일정을 찾을 수 없어' }, { status: 404 });
    }

    if (reason) {
      // 삭제는 이미 커밋됨 — 사유 기록 실패는 유실로만 처리하고 응답은 성공 유지
      try {
        await recordDeleteReason(userId, Number(id), reason.category, reason.text);
      } catch (err) {
        console.error('삭제 사유 기록 실패:', err);
      }
    }

    return NextResponse.json({ data: { id: Number(id) } });
  } catch {
    return NextResponse.json({ error: '일정 삭제 실패' }, { status: 500 });
  }
}
