import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { exchangeCodeForToken, fetchKakaoUserInfo } from '@/lib/kakao';
import { findOrCreateUser } from '@/lib/users';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    // 카카오 에러 (사용자가 취소 등)
    if (error) {
      return NextResponse.redirect(new URL('/login', request.url));
    }

    if (!code || !state) {
      return NextResponse.redirect(new URL('/login?error=invalid_request', request.url));
    }

    // CSRF 검증
    const session = await getSession();
    if (session.oauthState !== state) {
      return NextResponse.redirect(new URL('/login?error=invalid_state', request.url));
    }
    delete session.oauthState;

    // 토큰 교환
    const redirectUri = `${url.origin}/api/auth/kakao/callback`;
    const accessToken = await exchangeCodeForToken(code, redirectUri);

    // 유저 정보 조회
    const kakaoUser = await fetchKakaoUserInfo(accessToken);

    // 유저 조회/생성
    const user = await findOrCreateUser(kakaoUser);

    // 세션 저장
    session.userId = user.id;
    session.nickname = user.nickname ?? '사용자';
    await session.save();

    return NextResponse.redirect(new URL('/schedules', request.url));
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    console.error('[auth/kakao/callback] error:', message);

    if (message === 'MAX_USERS_REACHED') {
      return NextResponse.redirect(new URL('/login?error=max_users', request.url));
    }
    if (message === 'NOT_ALLOWED') {
      return NextResponse.redirect(new URL('/login?error=not_allowed', request.url));
    }

    return NextResponse.redirect(new URL('/login?error=auth_failed', request.url));
  }
}
