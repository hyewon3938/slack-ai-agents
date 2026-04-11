import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { unsealData } from 'iron-session';

const PUBLIC_PATHS = ['/login', '/api/auth', '/api/cron'];
const SESSION_COOKIE = 'life-dashboard-session';

/** Next.js 16 — middleware는 기본 Node.js 런타임에서 동작 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

/** 미들웨어 — 세션 쿠키 서명 검증 + 보안 헤더 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 보안 헤더 (모든 응답에 적용)
  const setSecurityHeaders = (res: NextResponse): NextResponse => {
    res.headers.set('X-Frame-Options', 'DENY');
    res.headers.set('X-Content-Type-Options', 'nosniff');
    res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    return res;
  };

  // 로컬 개발용 인증 바이패스 (production 금지)
  if (process.env.BYPASS_AUTH === 'true' && process.env.NODE_ENV !== 'production') {
    return setSecurityHeaders(NextResponse.next());
  }

  // 공개 경로
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return setSecurityHeaders(NextResponse.next());
  }

  // 정적 파일
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.ico') ||
    pathname === '/manifest.webmanifest'
  ) {
    return setSecurityHeaders(NextResponse.next());
  }

  // 세션 쿠키 검증 — 단순 존재가 아닌 서명 검증
  const cookie = request.cookies.get(SESSION_COOKIE);
  const secret = process.env.SESSION_SECRET;

  // 시크릿이 없으면 어떤 쿠키도 신뢰할 수 없음 → 로그인 페이지로
  if (!secret || secret.length < 32) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (!cookie?.value) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  try {
    // iron-session 봉인 해제 — 위변조/만료 시 throw
    const data = await unsealData<{ userId?: number }>(cookie.value, {
      password: secret,
    });
    if (!data || typeof data.userId !== 'number') {
      return NextResponse.redirect(new URL('/login', request.url));
    }
  } catch {
    // 위변조된 쿠키 — 강제 로그아웃
    const res = NextResponse.redirect(new URL('/login', request.url));
    res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  return setSecurityHeaders(NextResponse.next());
}
