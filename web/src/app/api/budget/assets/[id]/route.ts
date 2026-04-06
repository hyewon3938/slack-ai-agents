import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { updateAsset } from '@/features/budget/lib/queries';

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
    };

    if (body.balance !== undefined && (typeof body.balance !== 'number' || body.balance < 0)) {
      return NextResponse.json({ error: 'balance는 0 이상 숫자여야 합니다' }, { status: 400 });
    }

    const data = await updateAsset(userId, id, body);
    if (!data) return NextResponse.json({ error: '자산을 찾을 수 없습니다' }, { status: 404 });
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: '자산 수정 실패' }, { status: 500 });
  }
}
