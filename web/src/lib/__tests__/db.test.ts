import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// db.ts는 모듈 로드 시점에 환경변수를 읽으므로 테스트마다 모듈을 새로 불러온다.
// 값은 테스트 전용 placeholder.
const PROXY_URL = 'http://db-proxy.test';
const PROXY_KEY = 'test-proxy-key';

const loadDb = async (): Promise<typeof import('../db')> => {
  vi.resetModules();
  return import('../db');
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('DB_PROXY_URL', PROXY_URL);
  vi.stubEnv('DB_PROXY_API_KEY', PROXY_KEY);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('query', () => {
  it('DB_PROXY_URL이 없으면 요청하지 않고 에러를 던진다', async () => {
    vi.stubEnv('DB_PROXY_URL', '');
    const { query } = await loadDb();

    await expect(query('SELECT 1')).rejects.toThrow('DB_PROXY_URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('프록시 쿼리 경로로 인증 헤더와 캐시 없음 옵션을 붙여 POST한다', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ rows: [], rowCount: 0 }));
    const { query } = await loadDb();

    await query('SELECT * FROM t WHERE id = $1', [3]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${PROXY_URL}/api/db/query`);
    expect(init?.method).toBe('POST');
    expect(init?.cache).toBe('no-store');
    expect(init?.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${PROXY_KEY}`,
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      text: 'SELECT * FROM t WHERE id = $1',
      params: [3],
    });
  });

  it('응답이 실패면 본문의 error를 에러 메시지로 쓴다', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'relation does not exist' }, 400));
    const { query } = await loadDb();

    await expect(query('SELECT 1')).rejects.toThrow('relation does not exist');
  });

  it('실패 응답의 본문을 파싱할 수 없으면 상태 코드를 담은 메시지를 쓴다', async () => {
    fetchMock.mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 }));
    const { query } = await loadDb();

    await expect(query('SELECT 1')).rejects.toThrow('DB proxy error: 502');
  });
});

describe('queryOne', () => {
  it('첫 번째 행을 반환한다', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ rows: [{ id: 1 }, { id: 2 }], rowCount: 2 }));
    const { queryOne } = await loadDb();

    expect(await queryOne('SELECT id FROM t')).toEqual({ id: 1 });
  });

  it('행이 없으면 null을 반환한다', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ rows: [], rowCount: 0 }));
    const { queryOne } = await loadDb();

    expect(await queryOne('SELECT id FROM t')).toBeNull();
  });
});
