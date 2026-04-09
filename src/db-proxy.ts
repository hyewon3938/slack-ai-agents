import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { query } from './shared/db.js';
import { CONFIG } from './shared/config.js';

const PROXY_PORT = 3100;
const MAX_BODY_SIZE = 1_048_576; // 1MB

/** 허용된 CORS Origin (미설정 시 Vercel 도메인만 허용) */
const ALLOWED_ORIGIN = process.env['DB_PROXY_ALLOWED_ORIGIN'] ?? '';

/** DDL 및 위험 구문 차단 패턴 */
const DDL_PATTERN = /\b(DROP|CREATE|ALTER|TRUNCATE|RENAME|COMMENT ON|GRANT|REVOKE|VACUUM|CLUSTER|REINDEX|COPY)\b/i;

/** SQL 화이트리스트 검증 — DDL 차단 */
const validateSQL = (sql: string): string | null => {
  if (DDL_PATTERN.test(sql)) {
    return 'DDL 구문은 허용되지 않습니다';
  }
  return null;
};

/** API Key 검증 */
const authenticate = (req: IncomingMessage): boolean => {
  const authHeader = req.headers['authorization'] ?? '';
  return authHeader === `Bearer ${CONFIG.dbProxy.apiKey}`;
};

/** Origin 검증 */
const isAllowedOrigin = (origin: string | undefined): boolean => {
  if (!ALLOWED_ORIGIN) return true; // 미설정 시 모두 허용 (하위 호환)
  return origin === ALLOWED_ORIGIN;
};

/** CORS 헤더 생성 */
const corsHeaders = (origin: string | undefined): Record<string, string> => {
  const allowedOrigin = ALLOWED_ORIGIN || origin || '*';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
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
const jsonResponse = (res: ServerResponse, status: number, data: unknown, extraHeaders?: Record<string, string>): void => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...extraHeaders });
  res.end(JSON.stringify(data));
};

/** 요청 핸들러 */
const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const origin = req.headers['origin'];

  // CORS preflight (Vercel serverless → VM 요청 허용)
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(origin));
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

  // Origin 검증 (ALLOWED_ORIGIN 설정 시)
  if (ALLOWED_ORIGIN && !isAllowedOrigin(origin)) {
    jsonResponse(res, 403, { error: 'Forbidden' });
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

  // SQL 화이트리스트 검증 (DDL 차단)
  const sqlError = validateSQL(text);
  if (sqlError) {
    jsonResponse(res, 400, { error: sqlError });
    return;
  }

  // 쿼리 실행
  try {
    const result = await query(text, params);
    jsonResponse(res, 200, { rows: result.rows, rowCount: result.rowCount }, corsHeaders(origin));
  } catch (err) {
    console.error('[DB Proxy] 쿼리 오류:', err instanceof Error ? err.message : err);
    jsonResponse(res, 500, { error: 'Query failed' });
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
