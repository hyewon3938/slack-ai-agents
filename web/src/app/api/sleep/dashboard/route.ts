import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import {
  querySleepRecordsWithEvents,
  calculateSleepSummary,
  calculateDayOfWeekPattern,
} from '@/features/sleep/lib/queries';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    if (!from || !to) {
      return NextResponse.json({ error: 'from/to 파라미터 필요' }, { status: 400 });
    }

    const records = await querySleepRecordsWithEvents(userId, from, to);
    const summary = calculateSleepSummary(records);
    const dayOfWeekPattern = calculateDayOfWeekPattern(records);

    return NextResponse.json(
      { data: { records, summary, dayOfWeekPattern } },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  } catch {
    return NextResponse.json({ error: '수면 대시보드 조회 실패' }, { status: 500 });
  }
}
