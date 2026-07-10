import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createSleepRecord } from '@/features/sleep/lib/queries';
import { parseSleepRecordInput } from '@/features/sleep/lib/validate-input';

export async function POST(request: Request) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const parsed = parseSleepRecordInput(await request.json());
    if ('error' in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const data = await createSleepRecord(userId, parsed.data);
    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    console.error('[Sleep API]', request.url, err);
    return NextResponse.json({ error: '수면 기록 추가 실패' }, { status: 500 });
  }
}
