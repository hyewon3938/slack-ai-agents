import { NextResponse } from 'next/server';
import { saveDailyBudgetLog } from '@/features/budget/lib/queries';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: Request) {
  // Vercel cron 인증 검증
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env['CRON_SECRET'];
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await saveDailyBudgetLog(1); // user_id = 1 (단일 사용자)
    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    console.error('[daily-budget-log] 스냅샷 실패:', err);
    return NextResponse.json(
      { error: '스냅샷 실패' },
      { status: 500 },
    );
  }
}
