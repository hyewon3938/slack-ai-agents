import { NextResponse } from 'next/server';
import { runSettlementIfDue } from '@/features/budget/lib/facade';
import { listAllUserIds } from '@/lib/users';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env['CRON_SECRET'];
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const userIds = await listAllUserIds();
  const results: Array<{ userId: number; settled: boolean; yearMonth?: string; error?: string }> = [];

  for (const userId of userIds) {
    try {
      const result = await runSettlementIfDue(userId, now);
      results.push({
        userId,
        settled: result.settled,
        ...(result.snapshot && { yearMonth: result.snapshot.year_month }),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[monthly-settlement] user ${userId} 실패:`, msg);
      results.push({ userId, settled: false, error: msg });
    }
  }

  return NextResponse.json({ ok: true, results });
}
