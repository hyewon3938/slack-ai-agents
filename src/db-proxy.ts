import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { query } from './shared/db.js';
import { CONFIG } from './shared/config.js';

const PROXY_PORT = 3100;
const MAX_BODY_SIZE = 1_048_576; // 1MB

/** API Key 검증 */
const authenticate = (req: IncomingMessage): boolean => {
  const authHeader = req.headers['authorization'] ?? '';
  return authHeader === `Bearer ${CONFIG.dbProxy.apiKey}`;
};

/** 요청 바디 파싱 (1MB 제한) */
const parseBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;

    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > MAX_BODY_SIZE) {
        reject(new Error('Body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });

/** JSON 응답 헬퍼 */
const jsonResponse = (res: ServerResponse, status: number, data: unknown): void => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
};

/** 요청 핸들러 */
const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  // CORS preflight (Vercel serverless → VM 요청 허용)
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end();
    return;
  }

  // GET /health — 헬스체크 (인증 불필요)
  if (req.method === 'GET' && req.url === '/health') {
    try {
      await query('SELECT 1');
      jsonResponse(res, 200, { status: 'ok', db: 'connected' });
    } catch {
      jsonResponse(res, 503, { status: 'error', db: 'disconnected' });
    }
    return;
  }

  // POST /api/db/query 만 허용
  if (req.method !== 'POST' || req.url !== '/api/db/query') {
    jsonResponse(res, 404, { error: 'Not found' });
    return;
  }

  // 인증
  if (!authenticate(req)) {
    jsonResponse(res, 401, { error: 'Unauthorized' });
    return;
  }

  // 바디 파싱
  let body: unknown;
  try {
    const raw = await parseBody(req);
    body = JSON.parse(raw);
  } catch {
    jsonResponse(res, 400, { error: 'Invalid request body' });
    return;
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    typeof (body as Record<string, unknown>)['text'] !== 'string'
  ) {
    jsonResponse(res, 400, { error: 'Missing "text" field' });
    return;
  }

  const { text, params } = body as { text: string; params?: unknown[] };

  // 쿼리 실행
  try {
    const result = await query(text, params);
    jsonResponse(res, 200, { rows: result.rows, rowCount: result.rowCount });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Query failed';
    console.error('[DB Proxy] 쿼리 오류:', message);
    jsonResponse(res, 500, { error: message });
  }
};

/** DB 프록시 서버 시작 */
export const startDBProxy = (): void => {
  if (!CONFIG.dbProxy.apiKey) {
    console.log('[DB Proxy] DB_PROXY_API_KEY 미설정 — 프록시 서버 비활성화');
    return;
  }

  const server = createServer((req, res) => {
    handleRequest(req, res).catch((err: unknown) => {
      console.error('[DB Proxy] 처리 오류:', err);
      if (!res.headersSent) {
        jsonResponse(res, 500, { error: 'Internal server error' });
      }
    });
  });

  server.listen(PROXY_PORT, () => {
    console.log(`[DB Proxy] 프록시 서버 시작: http://localhost:${PROXY_PORT}`);
  });
};
