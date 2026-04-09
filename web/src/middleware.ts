import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/api/auth'];

export function middleware(request: NextRequest) {
  // 로컬 개발용 인증 바이패스
  if (process.env.BYPASS_AUTH === 'true' && process.env.NODE_ENV !== 'production') {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // 정적 파일 제외
  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon') || pathname.endsWith('.png')) {
    return NextResponse.next();
  }

  const session = request.cookies.get('life-dashboard-session');
  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
