import { NextResponse } from 'next/server';

// Vercel 웹 앱 liveness 엔드포인트
// 외부 업타임 모니터링(UptimeRobot)이 폴링하는 경로
// 인증 불필요 — 민감 정보 미포함, 단순 liveness 확인용
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ ok: true });
}
