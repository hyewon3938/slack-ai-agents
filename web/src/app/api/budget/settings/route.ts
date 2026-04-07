import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { queryTargetDate, upsertTargetDate, calcBudgetPreview } from '@/features/budget/lib/queries';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const previewTarget = searchParams.get('previewTarget');

    // 프리뷰 모드: 목표 날짜 변경 시 즉시 예산 미리보기
    if (previewTarget) {
      const preview = await calcBudgetPreview(userId, previewTarget);
      if (!preview) return NextResponse.json({ error: '유효하지 않은 날짜' }, { status: 400 });
      return NextResponse.json({ data: preview });
    }

    const targetDate = await queryTargetDate(userId);
    return NextResponse.json({ data: { target_date: targetDate } });
  } catch (err) {
    console.error('[Budget API]', request.url, err);
    return NextResponse.json({ error: '설정 조회 실패' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = (await request.json()) as { target_date?: string | null };
    const td = body.target_date;
    if (td !== null && td !== undefined && !/^\d{4}-\d{2}$/.test(td)) {
      return NextResponse.json({ error: 'target_date 형식: YYYY-MM' }, { status: 400 });
    }
    await upsertTargetDate(userId, td ?? null);
    return NextResponse.json({ data: { target_date: td ?? null } });
  } catch (err) {
    console.error('[Budget API]', request.url, err);
    return NextResponse.json({ error: '설정 저장 실패' }, { status: 500 });
  }
}
