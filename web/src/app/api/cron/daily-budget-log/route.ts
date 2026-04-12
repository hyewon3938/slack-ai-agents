import { NextResponse } from 'next/server';
import { saveDailyBudgetLog } from '@/features/budget/lib/queries';
import { resolveSnapshotDate } from '@/features/budget/lib/budget-calc';

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
    // Vercel cron 드리프트 방어: 발화 시각에서 1시간 버퍼를 차감한 KST 날짜로 저장
    // (cron 14:50 UTC 예약 → 15:xx 드리프트해도 KST 당일을 올바르게 반환)
    const targetDate = resolveSnapshotDate(new Date());
    const result = await saveDailyBudgetLog(1, { targetDate });
    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    console.error('[daily-budget-log] 스냅샷 실패:', err);
    return NextResponse.json(
      { error: '스냅샷 실패' },
      { status: 500 },
    );
  }
}
