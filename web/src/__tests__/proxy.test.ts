import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { sealData } from 'iron-session';
import { proxy } from '../proxy';

// 테스트 전용 비밀값 — 의미 없는 문자열 (32자 이상)
const TEST_SECRET = 'test-only-secret-0123456789abcdefghijklmnop';
const SESSION_COOKIE = 'life-dashboard-session';

const makeRequest = (path: string, cookie?: string): NextRequest =>
  new NextRequest(`http://localhost${path}`, {
    headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {},
  });

const seal = (data: Record<string, unknown>, password = TEST_SECRET): Promise<string> =>
  sealData(data, { password });

const isPassThrough = (res: Response): boolean => res.headers.get('x-middleware-next') === '1';

const redirectPath = (res: Response): string | null => {
  const location = res.headers.get('location');
  return location ? new URL(location).pathname : null;
};

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', TEST_SECRET);
  vi.stubEnv('BYPASS_AUTH', '');
  vi.stubEnv('NODE_ENV', 'test');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('proxy — 세션 검사', () => {
  it('유효한 세션이면 통과한다', async () => {
    const res = await proxy(makeRequest('/schedules', await seal({ userId: 1 })));

    expect(isPassThrough(res)).toBe(true);
  });

  it('세션 쿠키가 없으면 로그인으로 이동한다', async () => {
    const res = await proxy(makeRequest('/schedules'));

    expect(isPassThrough(res)).toBe(false);
    expect(redirectPath(res)).toBe('/login');
  });

  it('세션 비밀값이 없으면 유효한 쿠키라도 로그인으로 이동한다', async () => {
    const cookie = await seal({ userId: 1 });
    vi.stubEnv('SESSION_SECRET', '');

    const res = await proxy(makeRequest('/schedules', cookie));

    expect(redirectPath(res)).toBe('/login');
  });

  it('세션 비밀값이 32자 미만이면 로그인으로 이동한다', async () => {
    const cookie = await seal({ userId: 1 });
    vi.stubEnv('SESSION_SECRET', 'short-secret');

    const res = await proxy(makeRequest('/schedules', cookie));

    expect(redirectPath(res)).toBe('/login');
  });

  it('풀 수 없는 쿠키는 로그인으로 이동한다', async () => {
    const res = await proxy(makeRequest('/schedules', 'not-a-sealed-value'));

    expect(isPassThrough(res)).toBe(false);
    expect(redirectPath(res)).toBe('/login');
  });

  it('다른 비밀값으로 봉인된 쿠키는 로그인으로 이동한다', async () => {
    const cookie = await seal({ userId: 1 }, 'another-test-only-secret-zyxwvutsrqponmlk');

    const res = await proxy(makeRequest('/schedules', cookie));

    expect(redirectPath(res)).toBe('/login');
  });

  it.each([
    ['userId가 없는 세션', {}],
    ['userId가 문자열인 세션', { userId: '1' }],
  ])('%s은 로그인으로 이동한다', async (_label, data) => {
    const res = await proxy(makeRequest('/schedules', await seal(data)));

    expect(redirectPath(res)).toBe('/login');
  });

  it.each([
    ['풀 수 없는 쿠키', async (): Promise<string> => 'not-a-sealed-value'],
    [
      '다른 비밀값으로 봉인된 쿠키',
      async (): Promise<string> => seal({ userId: 1 }, 'another-test-only-secret-zyxwvutsrqponmlk'),
    ],
    ['userId가 없는 세션 쿠키', async (): Promise<string> => seal({})],
  ])('%s는 로그인으로 보내면서 쿠키를 지운다', async (_label, makeCookie) => {
    const res = await proxy(makeRequest('/schedules', await makeCookie()));

    expect(redirectPath(res)).toBe('/login');
    // 값은 비우고 만료일은 과거로 둔 Set-Cookie가 붙어야 브라우저가 쿠키를 버린다
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${SESSION_COOKIE}=;`);
    expect(setCookie).toMatch(/Expires=Thu, 01 Jan 1970/i);
  });

  it('세션 쿠키가 없으면 쿠키를 지우는 헤더를 붙이지 않는다', async () => {
    const res = await proxy(makeRequest('/schedules'));

    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('유효한 세션이면 쿠키를 건드리지 않는다', async () => {
    const res = await proxy(makeRequest('/schedules', await seal({ userId: 1 })));

    expect(res.headers.get('set-cookie')).toBeNull();
  });
});

describe('proxy — 세션 없이 통과하는 경로', () => {
  // app/ 아래 실제 공개 route 전부
  it.each([
    '/login',
    '/api/auth',
    '/api/auth/kakao',
    '/api/auth/kakao/callback',
    '/api/cron/daily-budget-log',
    '/api/cron/monthly-settlement',
    '/api/health',
  ])('공개 경로 %s는 세션 없이 통과한다', async (path) => {
    const res = await proxy(makeRequest(path));

    expect(isPassThrough(res)).toBe(true);
  });

  it.each(['/api/authx', '/api/auth-admin', '/loginfoo', '/api/cronjob', '/api/healthz'])(
    '공개 경로와 앞부분만 같은 경로 %s는 세션을 검사한다',
    async (path) => {
      const res = await proxy(makeRequest(path));

      expect(isPassThrough(res)).toBe(false);
      expect(redirectPath(res)).toBe('/login');
    },
  );

  it.each(['/icon.png', '/logo.svg', '/manifest.webmanifest'])(
    '정적 파일 %s는 세션 없이 통과한다',
    async (path) => {
      const res = await proxy(makeRequest(path));

      expect(isPassThrough(res)).toBe(true);
    },
  );

  it('세션이 필요한 API 경로는 세션 없이 통과하지 않는다', async () => {
    const res = await proxy(makeRequest('/api/schedules'));

    expect(redirectPath(res)).toBe('/login');
  });
});

describe('proxy — 개발용 인증 생략 플래그', () => {
  it('production이 아니면 플래그가 켜졌을 때 세션 없이 통과한다', async () => {
    vi.stubEnv('BYPASS_AUTH', 'true');
    vi.stubEnv('NODE_ENV', 'development');

    const res = await proxy(makeRequest('/schedules'));

    expect(isPassThrough(res)).toBe(true);
  });

  it('production에서는 플래그가 켜져 있어도 세션을 검사한다', async () => {
    vi.stubEnv('BYPASS_AUTH', 'true');
    vi.stubEnv('NODE_ENV', 'production');

    const res = await proxy(makeRequest('/schedules'));

    expect(redirectPath(res)).toBe('/login');
  });
});

describe('proxy — 보안 헤더', () => {
  it('통과 응답에 보안 헤더를 붙인다', async () => {
    const res = await proxy(makeRequest('/schedules', await seal({ userId: 1 })));

    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('Permissions-Policy')).toBe(
      'camera=(), microphone=(), geolocation=()',
    );
  });
});
