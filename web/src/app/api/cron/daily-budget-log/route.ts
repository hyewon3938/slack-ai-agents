import { NextResponse } from 'next/server';
import { saveDailyBudgetLog } from '@/features/budget/lib/queries';
import { resolvePreviousDayDate } from '@/features/budget/lib/billing/snapshot-date';
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
    // 새벽 5시(KST) cron 발화 → 전일 KST 날짜로 스냅샷 저장.
    // 크론 누락 시 수동 백필 용도로 ?date=YYYY-MM-DD override 허용.
    const dateParam = new URL(request.url).searchParams.get('date');
    const targetDate =
      dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
        ? dateParam
        : resolvePreviousDayDate(new Date());
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
