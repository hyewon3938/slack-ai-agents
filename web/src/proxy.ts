import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { unsealData } from 'iron-session';

const PUBLIC_PATHS = ['/login', '/api/auth', '/api/cron', '/api/health'];
const SESSION_COOKIE = 'life-dashboard-session';

/** 공개 경로 자신이거나 그 하위 경로일 때만 공개로 본다 (앞부분만 같은 다른 경로는 제외) */
const isPublicPath = (pathname: string): boolean =>
  PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

/** Next.js 16 — proxy는 기본 Node.js 런타임에서 동작 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

/** Proxy — 세션 쿠키 서명 검증 + 보안 헤더 */
export async function proxy(request: NextRequest) {
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
  if (isPublicPath(pathname)) {
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

  // iron-session 8의 unsealData는 위변조·만료·형식 오류여도 throw하지 않고 {}를 돌려준다.
  // 그래서 결과에 userId가 없으면 쓸 수 없는 쿠키로 보고 지운 뒤 로그인으로 보낸다.
  const data = await unsealData<{ userId?: unknown }>(cookie.value, { password: secret }).catch(
    () => null,
  );

  if (!data || typeof data.userId !== 'number') {
    const res = NextResponse.redirect(new URL('/login', request.url));
    res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  return setSecurityHeaders(NextResponse.next());
}
