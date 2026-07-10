import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createSleepEvent } from '@/features/sleep/lib/queries';
import { parseSleepEventInput } from '@/features/sleep/lib/validate-input';

export async function POST(request: Request) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const parsed = parseSleepEventInput(await request.json());
    if ('error' in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const data = await createSleepEvent(userId, parsed.data);
    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    console.error('[Sleep API]', request.url, err);
    return NextResponse.json({ error: '수면 이벤트 추가 실패' }, { status: 500 });
  }
}
