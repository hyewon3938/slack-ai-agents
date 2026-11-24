import { describe, expect, it } from 'vitest';
import { extractPublicPaths, extractRouteMethods, toUrlPath } from '../routes.js';

describe('toUrlPath', () => {
  const root = 'web/src/app';

  it('page와 route 파일을 URL로 바꾼다', () => {
    expect(toUrlPath('web/src/app/page.tsx', root)).toBe('/');
    expect(toUrlPath('web/src/app/budget/page.tsx', root)).toBe('/budget');
    expect(toUrlPath('web/src/app/api/routines/[id]/records/route.ts', root)).toBe('/api/routines/[id]/records');
  });

  it('라우트 그룹과 병렬 슬롯은 URL에서 뺀다', () => {
    expect(toUrlPath('web/src/app/(main)/sleep/page.tsx', root)).toBe('/sleep');
    expect(toUrlPath('web/src/app/@modal/login/page.tsx', root)).toBe('/login');
  });
});

describe('extractRouteMethods', () => {
  it('메서드별로 인증 헬퍼 호출을 찾는다', () => {
    const src = [
      "import { requireAuth } from '@/lib/auth';",
      'export async function GET() { const s = await requireAuth(); return s; }',
      'export const POST = async () => { return null; };',
      'export const helper = 1;',
    ].join('\n');
    expect(extractRouteMethods('route.ts', src)).toEqual([
      { method: 'GET', auth: ['requireAuth()'] },
      { method: 'POST', auth: [] },
    ]);
  });

  it('SECRET 환경변수 읽기를 인증 확인으로 적는다', () => {
    const src = "export async function GET(req: Request) { return req.headers.get('a') === process.env['CRON_SECRET']; }";
    expect(extractRouteMethods('route.ts', src)).toEqual([{ method: 'GET', auth: ['CRON_SECRET'] }]);
  });

  it('인증 모듈이 아닌 곳의 require 함수와 API 키 읽기는 세지 않는다', () => {
    const src = [
      "import { requireThing } from '@/lib/other';",
      "export async function GET() { requireThing(); return process.env['SOME_API_KEY']; }",
    ].join('\n');
    expect(extractRouteMethods('route.ts', src)).toEqual([{ method: 'GET', auth: [] }]);
  });
});

describe('extractPublicPaths', () => {
  it('이름에 PUBLIC이 들어간 문자열 배열을 읽는다', () => {
    const src = "const PUBLIC_PATHS = ['/login', '/api/health'];\nconst OTHER = ['/x'];";
    expect(extractPublicPaths('proxy.ts', src)).toEqual(['/login', '/api/health']);
  });
});
