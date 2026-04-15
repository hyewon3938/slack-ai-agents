import { NextResponse } from 'next/server';
import { saveDailyBudgetLog } from '@/features/budget/lib/queries';
import { resolveSnapshotDate } from '@/features/budget/lib/billing/snapshot-date';
import { listAllUserIds } from '@/lib/users';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env['CRON_SECRET'];
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Vercel cron 드리프트 방어: 발화 시각에서 1시간 버퍼를 차감한 KST 날짜로 저장
    const targetDate = resolveSnapshotDate(new Date());
    const userIds = await listAllUserIds();

    const results = await Promise.all(
      userIds.map(async (uid) => {
        try {
          const data = await saveDailyBudgetLog(uid, { targetDate });
          return { userId: uid, ok: true, data };
        } catch (err) {
          console.error(`[daily-budget-log] user=${uid}`, err);
          return { userId: uid, ok: false };
        }
      }),
    );

    return NextResponse.json({ ok: true, results });
  } catch (err) {
    console.error('[daily-budget-log] 스냅샷 실패:', err);
    return NextResponse.json({ error: '스냅샷 실패' }, { status: 500 });
  }
}
