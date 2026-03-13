import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

/** GET: 현재 세션 정보 반환 */
export async function GET() {
  try {
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ data: { authenticated: false } });
    }
    return NextResponse.json({
      data: { authenticated: true, userId: session.userId, nickname: session.nickname },
    });
  } catch {
    return NextResponse.json({ error: '세션 조회 실패' }, { status: 500 });
  }
}

/** DELETE: 로그아웃 */
export async function DELETE() {
  try {
    const session = await getSession();
    session.destroy();
    return NextResponse.json({ data: { authenticated: false } });
  } catch {
    return NextResponse.json({ error: '로그아웃 실패' }, { status: 500 });
  }
}
