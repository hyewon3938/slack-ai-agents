import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { password?: string };
    const password = body.password;

    if (!password || password !== process.env.DASHBOARD_PASSWORD) {
      return NextResponse.json({ error: '비밀번호가 틀렸어' }, { status: 401 });
    }

    const session = await getSession();
    session.authenticated = true;
    await session.save();

    return NextResponse.json({ data: { authenticated: true } });
  } catch {
    return NextResponse.json({ error: '로그인 실패' }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const session = await getSession();
    session.destroy();
    return NextResponse.json({ data: { authenticated: false } });
  } catch {
    return NextResponse.json({ error: '로그아웃 실패' }, { status: 500 });
  }
}
