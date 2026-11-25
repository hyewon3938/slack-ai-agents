import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// ─── DB mock ────────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
const mockToolConnected = vi.fn(() => false);

vi.mock('../shared/db.js', () => ({
  query: mockQuery,
  isSqlToolPoolConnected: mockToolConnected,
  connectDB: vi.fn(),
  disconnectDB: vi.fn(),
}));

vi.mock('../shared/config.js', () => ({
  CONFIG: {
    slack: { botToken: 't', signingSecret: 's', appToken: 'a' },
    llm: { provider: 'anthropic', model: '', anthropicApiKey: 'k' },
    channels: { life: 'C1', project: '', insight: '', money: '' },
    db: { url: 'postgresql://test' },
    dbProxy: { apiKey: 'test-api-key-at-least-32-chars-long-xxxx' },
  },
}));

// ─── 헬퍼 ──────────────────────────────────────────────────────────────────

const makeRequest = async (
  port: number,
  options: {
    method?: string;
    path?: string;
    headers?: Record<string, string>;
    body?: unknown;
    rawBody?: string;
  } = {},
): Promise<{ status: number; body: unknown }> => {
  const { method = 'POST', path = '/api/db/query', headers = {}, body, rawBody } = options;

  const res = await fetch(`http://localhost:${port}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });

  const responseBody = await res.json().catch(() => ({}));
  return { status: res.status, body: responseBody };
};

const AUTH = { Authorization: 'Bearer test-api-key-at-least-32-chars-long-xxxx' };

// ─── 테스트 ─────────────────────────────────────────────────────────────────

describe('DB Proxy Server', () => {
  let server: Server;
  let port: number;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { handleRequest } = await import('../db-proxy.js');

    server = createServer((req, res) => {
      handleRequest(req, res).catch(() => {
        if (!res.headersSent) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      });
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  // ── 인증 ──
  describe('인증', () => {
    it('인증 없으면 401', async () => {
      const { status } = await makeRequest(port, { body: { text: 'SELECT 1' } });
      expect(status).toBe(401);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('잘못된 키는 401', async () => {
      const { status } = await makeRequest(port, {
        headers: { Authorization: 'Bearer wrong-key-wrong-key-wrong-key-wrong' },
        body: { text: 'SELECT 1' },
      });
      expect(status).toBe(401);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('올바른 키는 통과', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ one: 1 }], rowCount: 1 });
      const { status } = await makeRequest(port, {
        headers: AUTH,
        body: { text: 'SELECT 1' },
      });
      expect(status).toBe(200);
    });

    it('스킴이 소문자(bearer)면 키가 맞아도 401', async () => {
      const { status } = await makeRequest(port, {
        headers: { Authorization: 'bearer test-api-key-at-least-32-chars-long-xxxx' },
        body: { text: 'SELECT 1' },
      });
      expect(status).toBe(401);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  // ── 허용 쿼리 ──
  describe('허용 쿼리', () => {
    it('SELECT 통과', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });
      const { status, body } = await makeRequest(port, {
        headers: AUTH,
        body: { text: 'SELECT * FROM schedules WHERE user_id = $1', params: [1] },
      });
      expect(status).toBe(200);
      expect(body).toEqual({ rows: [{ id: 1 }], rowCount: 1 });
      expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM schedules WHERE user_id = $1', [1]);
    });

    it('WITH CTE 통과', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const { status } = await makeRequest(port, {
        headers: AUTH,
        body: { text: 'WITH x AS (SELECT 1) SELECT * FROM x' },
      });
      expect(status).toBe(200);
    });

    it('INSERT 통과', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      const { status } = await makeRequest(port, {
        headers: AUTH,
        body: { text: 'INSERT INTO schedules (title) VALUES ($1)', params: ['x'] },
      });
      expect(status).toBe(200);
    });

    it('UPDATE 통과', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      const { status } = await makeRequest(port, {
        headers: AUTH,
        body: { text: 'UPDATE schedules SET title = $1 WHERE id = $2', params: ['x', 1] },
      });
      expect(status).toBe(200);
    });

    it('DELETE 통과', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      const { status } = await makeRequest(port, {
        headers: AUTH,
        body: { text: 'DELETE FROM schedules WHERE id = $1', params: [1] },
      });
      expect(status).toBe(200);
    });
  });

  // ── 화이트리스트 차단 ──
  describe('SQL 화이트리스트 차단', () => {
    const blocked: Array<[string, string]> = [
      ['DROP', 'DROP TABLE schedules'],
      ['TRUNCATE', 'TRUNCATE TABLE schedules'],
      ['ALTER', 'ALTER TABLE schedules ADD COLUMN x int'],
      ['CREATE', 'CREATE TABLE t (id int)'],
      ['GRANT', 'GRANT ALL ON schedules TO public'],
      ['REVOKE', 'REVOKE ALL ON schedules FROM public'],
      ['COPY', "COPY schedules TO '/tmp/out.csv'"],
      ['DO block', 'DO $$ BEGIN END $$'],
      ['CALL', 'CALL some_proc()'],
      ['pg_read_file', "SELECT pg_read_file('/etc/passwd')"],
      ['pg_sleep (SSRF probe)', 'SELECT pg_sleep(10)'],
      ['dblink', "SELECT dblink('host=evil', 'SELECT 1')"],
    ];

    for (const [name, sql] of blocked) {
      it(`차단: ${name}`, async () => {
        const { status, body } = await makeRequest(port, {
          headers: AUTH,
          body: { text: sql },
        });
        expect(status).toBe(400);
        expect((body as { error: string }).error).toBe('Query rejected');
        expect(mockQuery).not.toHaveBeenCalled();
      });
    }

    it('차단: 여러 statement (stacked)', async () => {
      const { status } = await makeRequest(port, {
        headers: AUTH,
        body: { text: 'SELECT 1; DROP TABLE schedules' },
      });
      expect(status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('차단: 빈 SQL', async () => {
      const { status } = await makeRequest(port, {
        headers: AUTH,
        body: { text: '' },
      });
      expect(status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('차단: 매우 긴 SQL', async () => {
      const { status } = await makeRequest(port, {
        headers: AUTH,
        body: { text: 'SELECT ' + '1,'.repeat(6000) + '1' },
      });
      expect(status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it.each([
      ['pg_ls_dir', "SELECT pg_ls_dir('.')"],
      ['pg_stat_file', "SELECT pg_stat_file('x')"],
      ['pg_read_binary_file', "SELECT pg_read_binary_file('x')"],
      ['lo_import', "SELECT lo_import('x')"],
      ['lo_export', "SELECT lo_export(1, 'x')"],
      ['set_config', "SELECT set_config('x', 'y', false)"],
      ['pg_hba_file_rules', 'SELECT * FROM pg_hba_file_rules'],
    ])('차단 대상 함수·뷰 거절: %s', async (_name, sql) => {
      const { status, body } = await makeRequest(port, {
        headers: AUTH,
        body: { text: sql },
      });
      expect(status).toBe(400);
      expect((body as { error: string }).error).toBe('Query rejected');
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it.each([
      ['SET', 'SET search_path = public'],
      ['SHOW', 'SHOW ALL'],
      ['EXPLAIN', 'EXPLAIN SELECT 1'],
      ['VACUUM', 'VACUUM schedules'],
    ])('허용 목록에 없는 첫 키워드 거절: %s', async (_name, sql) => {
      const { status } = await makeRequest(port, {
        headers: AUTH,
        body: { text: sql },
      });
      expect(status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('허용: 끝에 세미콜론 하나는 단일 statement로 봄', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const { status } = await makeRequest(port, {
        headers: AUTH,
        body: { text: 'SELECT 1;' },
      });
      expect(status).toBe(200);
    });

    it('허용: DROP 문자열이 값에만 있는 경우 (주석/리터럴 제거)', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const { status } = await makeRequest(port, {
        headers: AUTH,
        body: { text: "SELECT * FROM schedules WHERE title = 'DROP TABLE'" },
      });
      expect(status).toBe(200);
    });

    it.each([
      ['닫히지 않은 문자열', "SELECT 'abc"],
      ['닫히지 않은 주석', 'SELECT 1 /* x'],
      ['닫히지 않은 달러 인용', 'SELECT $$abc'],
    ])('해석할 수 없는 SQL은 거절: %s', async (_name, sql) => {
      const { status } = await makeRequest(port, {
        headers: AUTH,
        body: { text: sql },
      });
      expect(status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it.each([
      ['달러 인용 뒤', "SELECT $$a$$; DROP TABLE schedules"],
      ['E 문자열 뒤', "SELECT E'a\\''; DROP TABLE schedules"],
      ['중첩 주석 뒤', 'SELECT 1 /* a /* b */ */; DROP TABLE schedules'],
    ])('문자열·주석 경계를 PostgreSQL과 같게 읽어 두 번째 문장을 거절: %s', async (_name, sql) => {
      const { status } = await makeRequest(port, {
        headers: AUTH,
        body: { text: sql },
      });
      expect(status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it.each([
      ['달러 인용', 'SELECT $tag$; DROP TABLE x $tag$ AS t'],
      ['주석 안 세미콜론', 'SELECT 1 -- ; DROP TABLE x'],
      ['E 문자열', "SELECT E'pg_ls_dir \\' ;'"],
    ])('허용: 문자열·주석 안 키워드와 세미콜론은 검사하지 않음 (%s)', async (_name, sql) => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const { status } = await makeRequest(port, {
        headers: AUTH,
        body: { text: sql },
      });
      expect(status).toBe(200);
    });

    it.each([
      ['16진 리터럴 뒤 함수', "SELECT 0xe-pg_read_file('/etc/hostname')::int"],
      ['16진 리터럴 뒤 함수 (대문자 접두)', "SELECT 0XE-pg_ls_dir('.')"],
      ['숫자 뒤 이어진 문자', 'SELECT 1ex'],
      ['별칭 자리의 CASE', 'SELECT 1 case FROM schedules'],
    ])('숫자·CASE 표기를 DB와 같게 읽어 거절: %s', async (_name, sql) => {
      const { status } = await makeRequest(port, {
        headers: AUTH,
        body: { text: sql },
      });
      expect(status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('허용: 16진·지수 숫자 표기', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const { status } = await makeRequest(port, {
        headers: AUTH,
        body: { text: 'SELECT * FROM schedules WHERE id > 0x1F AND id < 1e3' },
      });
      expect(status).toBe(200);
    });

    it('차단 대상 함수는 큰따옴표 식별자여도 거절', async () => {
      const { status } = await makeRequest(port, {
        headers: AUTH,
        body: { text: 'SELECT "pg_ls_dir"(\'.\')' },
      });
      expect(status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  // ── 입력 검증 ──
  describe('입력 검증', () => {
    it('잘못된 JSON → 400', async () => {
      const { status } = await makeRequest(port, {
        headers: AUTH,
        rawBody: 'not-json',
      });
      expect(status).toBe(400);
    });

    it('text 필드 누락 → 400', async () => {
      const { status } = await makeRequest(port, {
        headers: AUTH,
        body: { query: 'SELECT 1' },
      });
      expect(status).toBe(400);
    });

    it('params가 배열 아님 → 400', async () => {
      const { status } = await makeRequest(port, {
        headers: AUTH,
        body: { text: 'SELECT 1', params: 'bad' },
      });
      expect(status).toBe(400);
    });

    it('params 너무 많음 → 400', async () => {
      const { status } = await makeRequest(port, {
        headers: AUTH,
        body: { text: 'SELECT 1', params: new Array(101).fill(0) },
      });
      expect(status).toBe(400);
    });
  });

  // ── 라우팅 ──
  describe('라우팅', () => {
    it('다른 경로는 404', async () => {
      const { status } = await makeRequest(port, {
        path: '/api/other',
        headers: AUTH,
        body: { text: 'SELECT 1' },
      });
      expect(status).toBe(404);
    });

    it('GET /health 는 인증 없이 통과', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 });
      const { status, body } = await makeRequest(port, {
        method: 'GET',
        path: '/health',
      });
      expect(status).toBe(200);
      expect(body).toEqual({ ok: true, sqlToolRole: false });
    });

    it('GET /health 는 SQL 도구 전용 역할 연결 여부를 불린 하나로만 낸다', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 });
      mockToolConnected.mockReturnValueOnce(true);
      const { status, body } = await makeRequest(port, {
        method: 'GET',
        path: '/health',
      });
      expect(status).toBe(200);
      expect(body).toEqual({ ok: true, sqlToolRole: true });
    });

    it('DB 죽으면 /health 503', async () => {
      mockQuery.mockRejectedValueOnce(new Error('conn refused'));
      const { status, body } = await makeRequest(port, {
        method: 'GET',
        path: '/health',
      });
      expect(status).toBe(503);
      expect(body).toEqual({ ok: false, sqlToolRole: false });
    });

    it('GET /health/detail — 인증 없으면 401', async () => {
      const { status } = await makeRequest(port, {
        method: 'GET',
        path: '/health/detail',
      });
      expect(status).toBe(401);
    });

    it('GET /health/detail — 인증 + DB 정상이면 200 + 상세 정보', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 });
      const { status, body } = await makeRequest(port, {
        method: 'GET',
        path: '/health/detail',
        headers: AUTH,
      });
      expect(status).toBe(200);
      expect(body).toMatchObject({
        ok: true,
        db: { status: 'ok' },
      });
      expect(typeof (body as { uptime: number }).uptime).toBe('number');
      expect(typeof (body as { db: { latencyMs: number } }).db.latencyMs).toBe('number');
    });

    it('GET /health/detail — DB 죽으면 503 + db.status=error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('conn refused'));
      const { status, body } = await makeRequest(port, {
        method: 'GET',
        path: '/health/detail',
        headers: AUTH,
      });
      expect(status).toBe(503);
      expect(body).toMatchObject({
        ok: false,
        db: { status: 'error' },
      });
    });
  });

  // ── 에러 응답 일반화 ──
  describe('에러 응답', () => {
    it('DB 에러 시 500에 내부 메시지가 노출되지 않음', async () => {
      mockQuery.mockRejectedValueOnce(new Error('connection refused: secret-host:5432'));
      const { status, body } = await makeRequest(port, {
        headers: AUTH,
        body: { text: 'SELECT 1' },
      });
      expect(status).toBe(500);
      expect((body as { error: string }).error).toBe('Query failed');
      expect(JSON.stringify(body)).not.toContain('secret-host');
    });
  });
});
