import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getKakaoAuthUrl } from '@/lib/kakao';

export async function GET(request: Request) {
  try {
    const { origin } = new URL(request.url);
    const redirectUri = `${origin}/api/auth/kakao/callback`;
    const state = randomBytes(16).toString('hex');

    // state를 세션에 저장 (CSRF 방지)
    const session = await getSession();
    session.oauthState = state;
    await session.save();

    const authUrl = getKakaoAuthUrl(redirectUri, state);
    return NextResponse.redirect(authUrl);
  } catch (err) {
    console.error('[auth/kakao] redirect error:', err);
    return NextResponse.redirect(new URL('/login?error=auth_failed', request.url));
  }
}
