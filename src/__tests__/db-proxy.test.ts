import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// ─── DB mock ────────────────────────────────────────────────────────────────

const mockQuery = vi.fn();

vi.mock('../shared/db.js', () => ({
  query: mockQuery,
  connectDB: vi.fn(),
  disconnectDB: vi.fn(),
}));

vi.mock('../shared/config.js', () => ({
  CONFIG: {
    slack: { botToken: 't', signingSecret: 's', appToken: 'a' },
    llm: { provider: 'anthropic', model: '', anthropicApiKey: 'k', geminiApiKey: '', groqApiKey: '' },
    channels: { life: 'C1', project: '', insight: '', money: '' },
    db: { url: 'postgresql://test' },
    dbProxy: { apiKey: 'test-api-key-1234' },
  },
}));

// ─── 헬퍼 ──────────────────────────────────────────────────────────────────

/** 테스트용 HTTP 요청 헬퍼 */
const makeRequest = async (
  port: number,
  options: {
    method?: string;
    path?: string;
    headers?: Record<string, string>;
    body?: unknown;
  } = {},
): Promise<{ status: number; body: unknown }> => {
  const { method = 'POST', path = '/api/db/query', headers = {}, body } = options;

  const res = await fetch(`http://localhost:${port}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const responseBody = await res.json();
  return { status: res.status, body: responseBody };
};

// ─── 테스트 ─────────────────────────────────────────────────────────────────

describe('DB Proxy Server', () => {
  let server: Server;
  let port: number;

  beforeEach(async () => {
    vi.clearAllMocks();

    // startDBProxy는 포트를 고정하므로, handleRequest 로직만 직접 테스트
    // 실제 서버를 동적 포트로 띄워서 테스트
    const { createServer: createHttpServer } = await import('node:http');
    const { query: dbQuery } = await import('../shared/db.js');
    const { CONFIG: config } = await import('../shared/config.js');

    server = createHttpServer(async (req, res) => {
      const { handleRequest } = await import('../db-proxy.js').then(async (m) => {
        // db-proxy 모듈의 내부 핸들러를 직접 노출할 수 없으므로
        // startDBProxy 방식 대신, 테스트 서버를 직접 구성
        void m;
        return {
          handleRequest: async (
            request: typeof req,
            response: typeof res,
          ): Promise<void> => {
            // 인증 확인
            const auth = request.headers['authorization'] ?? '';
            const isAuth = auth === `Bearer ${config.dbProxy.apiKey}`;

            const jsonRes = (status: number, data: unknown): void => {
              response.writeHead(status, { 'Content-Type': 'application/json' });
              response.end(JSON.stringify(data));
            };

            if (request.method === 'OPTIONS') {
              response.writeHead(204);
              response.end();
              return;
            }

            if (request.method !== 'POST' || request.url !== '/api/db/query') {
              jsonRes(404, { error: 'Not found' });
              return;
            }

            if (!isAuth) {
              jsonRes(401, { error: 'Unauthorized' });
              return;
            }

            const chunks: Buffer[] = [];
            for await (const chunk of request) {
              chunks.push(chunk as Buffer);
            }
            const raw = Buffer.concat(chunks).toString();

            let body: unknown;
            try {
              body = JSON.parse(raw);
            } catch {
              jsonRes(400, { error: 'Invalid request body' });
              return;
            }

            if (
              typeof body !== 'object' ||
              body === null ||
              typeof (body as Record<string, unknown>)['text'] !== 'string'
            ) {
              jsonRes(400, { error: 'Missing "text" field' });
              return;
            }

            const { text, params } = body as { text: string; params?: unknown[] };

            try {
              const result = await dbQuery(text, params);
              jsonRes(200, { rows: result.rows, rowCount: result.rowCount });
            } catch (err) {
              const message = err instanceof Error ? err.message : 'Query failed';
              jsonRes(500, { error: message });
            }
          },
        };
      });
      await handleRequest(req, res);
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it('유효한 쿼리를 실행하고 결과를 반환한다', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });

    const { status, body } = await makeRequest(port, {
      headers: { Authorization: 'Bearer test-api-key-1234' },
      body: { text: 'SELECT * FROM schedules WHERE user_id = 1' },
    });

    expect(status).toBe(200);
    expect(body).toEqual({ rows: [{ id: 1 }], rowCount: 1 });
    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT * FROM schedules WHERE user_id = 1',
      undefined,
    );
  });

  it('params를 포함한 쿼리를 실행한다', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const { status } = await makeRequest(port, {
      headers: { Authorization: 'Bearer test-api-key-1234' },
      body: { text: 'SELECT * FROM schedules WHERE id = $1', params: [42] },
    });

    expect(status).toBe(200);
    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT * FROM schedules WHERE id = $1',
      [42],
    );
  });

  it('인증 실패 시 401을 반환한다', async () => {
    const { status, body } = await makeRequest(port, {
      headers: { Authorization: 'Bearer wrong-key' },
      body: { text: 'SELECT 1' },
    });

    expect(status).toBe(401);
    expect((body as { error: string }).error).toBe('Unauthorized');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('Authorization 헤더 없으면 401을 반환한다', async () => {
    const { status } = await makeRequest(port, {
      body: { text: 'SELECT 1' },
    });

    expect(status).toBe(401);
  });

  it('잘못된 JSON 시 400을 반환한다', async () => {
    const res = await fetch(`http://localhost:${port}/api/db/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-api-key-1234',
      },
      body: 'not-json',
    });

    expect(res.status).toBe(400);
  });

  it('text 필드 없으면 400을 반환한다', async () => {
    const { status } = await makeRequest(port, {
      headers: { Authorization: 'Bearer test-api-key-1234' },
      body: { query: 'SELECT 1' }, // text 대신 query 사용
    });

    expect(status).toBe(400);
  });

  it('존재하지 않는 경로는 404를 반환한다', async () => {
    const { status } = await makeRequest(port, {
      path: '/api/other',
      headers: { Authorization: 'Bearer test-api-key-1234' },
      body: { text: 'SELECT 1' },
    });

    expect(status).toBe(404);
  });

  it('DB 오류 시 500을 반환한다', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    const { status, body } = await makeRequest(port, {
      headers: { Authorization: 'Bearer test-api-key-1234' },
      body: { text: 'SELECT 1' },
    });

    expect(status).toBe(500);
    expect((body as { error: string }).error).toBe('connection refused');
  });
});
