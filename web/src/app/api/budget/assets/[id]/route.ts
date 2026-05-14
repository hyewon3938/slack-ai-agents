import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { updateAsset, setDefaultAsset, clearDefaultAsset } from '@/features/budget/lib/queries';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id: rawId } = await params;
    const id = parseInt(rawId, 10);
    if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID' }, { status: 400 });

    const body = (await request.json()) as {
      balance?: number;
      available_amount?: number;
      memo?: string | null;
      is_default?: boolean;
    };

    if (body.balance !== undefined && (typeof body.balance !== 'number' || body.balance < 0)) {
      return NextResponse.json({ error: 'balance는 0 이상 숫자여야 합니다' }, { status: 400 });
    }

    let data = null;
    if (body.is_default !== undefined) {
      try {
        data =
          body.is_default === true
            ? await setDefaultAsset(userId, id)
            : await clearDefaultAsset(userId, id);
      } catch (err) {
        if (err instanceof Error && err.message === 'EMERGENCY_ASSET_CANNOT_BE_DEFAULT') {
          return NextResponse.json(
            { error: '비상금 자산은 기본 자산으로 지정할 수 없습니다' },
            { status: 400 },
          );
        }
        throw err;
      }
    }

    if (
      body.balance !== undefined ||
      body.available_amount !== undefined ||
      body.memo !== undefined
    ) {
      data = await updateAsset(userId, id, body);
    }

    if (!data) return NextResponse.json({ error: '자산을 찾을 수 없습니다' }, { status: 404 });
    return NextResponse.json({ data });
  } catch (err) {
    console.error('[Budget API]', request.url, err);
    return NextResponse.json({ error: '자산 수정 실패' }, { status: 500 });
  }
}
