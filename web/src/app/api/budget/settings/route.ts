import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getBudgetPreview } from '@/features/budget/lib/facade';
import {
  readTargetMonth,
  analyzeTargetDateChange,
  applyTargetDateChange,
} from '@/features/budget/lib/repository/settings-repo';

export const dynamic = 'force-dynamic';

function isValidTargetDate(td: string | null | undefined): td is string | null {
  return td === null || td === undefined || /^\d{4}-\d{2}$/.test(td);
}

export async function GET(request: Request) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const previewTarget = searchParams.get('previewTarget');

    if (previewTarget) {
      const preview = await getBudgetPreview(userId, new Date(), previewTarget);
      if (!preview) return NextResponse.json({ error: '유효하지 않은 날짜' }, { status: 400 });
      return NextResponse.json({ data: preview });
    }

    const targetDate = await readTargetMonth(userId);
    return NextResponse.json({ data: { target_date: targetDate } });
  } catch (err) {
    console.error('[Budget API] settings GET', err);
    return NextResponse.json({ error: '설정 조회 실패' }, { status: 500 });
  }
}

/**
 * target_date 변경 — preview/apply 분기 (ADR 0018).
 *
 * ?preview=true: 영향 분석만 반환 (DB 미변경)
 * (없음): OFF 할부 자산 보정 + budget_settings UPDATE
 *
 * 응답: TargetDateChangePreview { oldTargetDate, newTargetDate, affectedGroups, totalDelta }
 */
export async function PUT(request: Request) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const previewMode = searchParams.get('preview') === 'true';

    const body = (await request.json()) as { target_date?: string | null };
    const td = body.target_date ?? null;
    if (!isValidTargetDate(td)) {
      return NextResponse.json({ error: 'target_date 형식: YYYY-MM' }, { status: 400 });
    }

    const result = previewMode
      ? await analyzeTargetDateChange(userId, td)
      : await applyTargetDateChange(userId, td);
    return NextResponse.json({ data: result });
  } catch (err) {
    console.error('[Budget API] settings PUT', err);
    return NextResponse.json({ error: '설정 저장 실패' }, { status: 500 });
  }
}
