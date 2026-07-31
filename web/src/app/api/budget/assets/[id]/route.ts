import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { updateAsset, setDefaultAsset, clearDefaultAsset } from '@/features/budget/lib/queries';
import { getTodayISO } from '@/lib/kst';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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
      balance_as_of?: string;
    };

    if (body.balance !== undefined && (typeof body.balance !== 'number' || body.balance < 0)) {
      return NextResponse.json({ error: 'balance는 0 이상 숫자여야 합니다' }, { status: 400 });
    }

    const today = getTodayISO();
    if (body.balance_as_of !== undefined) {
      if (typeof body.balance_as_of !== 'string' || !DATE_PATTERN.test(body.balance_as_of)) {
        return NextResponse.json({ error: '기준일 형식이 잘못됐습니다' }, { status: 400 });
      }
      // 아직 오지 않은 입출금을 반영했다고 주장할 수 없다 (#615)
      if (body.balance_as_of > today) {
        return NextResponse.json({ error: '기준일은 오늘 이후일 수 없습니다' }, { status: 400 });
      }
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
      // 잔액이 바뀌면 기준일도 같이 옮긴다. 안 옮기면 이미 반영된 출금이
      // 새 잔액 위에 다시 복원돼 기준선이 부풀어 오른다 (#615).
      const balanceChanged = body.balance !== undefined || body.available_amount !== undefined;
      const balanceAsOf = body.balance_as_of ?? (balanceChanged ? today : undefined);
      data = await updateAsset(userId, id, { ...body, balance_as_of: balanceAsOf });
    }

    if (!data) return NextResponse.json({ error: '자산을 찾을 수 없습니다' }, { status: 404 });
    return NextResponse.json({ data });
  } catch (err) {
    console.error('[Budget API]', request.url, err);
    return NextResponse.json({ error: '자산 수정 실패' }, { status: 500 });
  }
}
