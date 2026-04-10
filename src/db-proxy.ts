import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { query } from './shared/db.js';
import { CONFIG } from './shared/config.js';

const PROXY_PORT = 3100;
const MAX_BODY_SIZE = 1_048_576; // 1MB
const MAX_SQL_LENGTH = 10_000;
const MAX_PARAMS = 100;

/** 타이밍 공격 방어: 상수 시간 비교 */
const safeEqual = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
};

/** API Key 검증 */
const authenticate = (req: IncomingMessage): boolean => {
  const authHeader = req.headers['authorization'] ?? '';
  const expected = `Bearer ${CONFIG.dbProxy.apiKey}`;
  return safeEqual(authHeader, expected);
};

// ---- SQL 화이트리스트 검증 ----

/** SQL에서 주석과 문자열 리터럴 제거 */
const stripCommentsAndStrings = (sql: string): string =>
  sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
    .replace(/'(?:''|[^'])*'/g, '')
    .replace(/"[^"]*"/g, '');

/** 복수 SQL 문 감지 (주석·문자열 제외) */
const hasMultipleStatements = (sql: string): boolean => {
  const stripped = stripCommentsAndStrings(sql);
  const parts = stripped.split(';').filter((s) => s.trim().length > 0);
  return parts.length > 1;
};

/** 첫 키워드 추출 */
const firstKeyword = (sql: string): string => {
  const cleaned = sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
    .trim();
  const match = /^(\w+)/i.exec(cleaned);
  return (match?.[1] ?? '').toUpperCase();
};

/** 허용 키워드 (SELECT/WITH/INSERT/UPDATE/DELETE) */
const ALLOWED_KEYWORDS = new Set(['SELECT', 'WITH', 'INSERT', 'UPDATE', 'DELETE']);

/**
 * 차단 패턴 — 주석/문자열 제거 후 대소문자 무관 매칭.
 * pg 시스템 카탈로그/파일 접근/프로시저/DDL 방어.
 */
const BLOCKED_PATTERNS: RegExp[] = [
  /\bDROP\b/i,
  /\bTRUNCATE\b/i,
  /\bALTER\b/i,
  /\bCREATE\b/i,
  /\bGRANT\b/i,
  /\bREVOKE\b/i,
  /\bCOPY\b/i,              // 파일 I/O
  /\bDO\b\s*\$/i,           // anonymous code block
  /\bCALL\b/i,              // 프로시저 호출
  /\bpg_read_file\b/i,
  /\bpg_ls_dir\b/i,
  /\bpg_stat_file\b/i,
  /\bpg_read_binary_file\b/i,
  /\blo_import\b/i,
  /\blo_export\b/i,
  /\bpg_sleep\b/i,
  /\bset_config\b/i,
  /\bdblink/i,
  /\bpg_hba_file_rules\b/i,
];

/**
 * SQL 화이트리스트 검증.
 * 통과 시 null, 실패 시 에러 코드 반환.
 */
const validateProxySQL = (sql: string): string | null => {
  if (typeof sql !== 'string' || sql.length === 0) return 'EMPTY_SQL';
  if (sql.length > MAX_SQL_LENGTH) return 'SQL_TOO_LONG';
  if (hasMultipleStatements(sql)) return 'MULTIPLE_STATEMENTS';

  const keyword = firstKeyword(sql);
  if (!ALLOWED_KEYWORDS.has(keyword)) return 'DISALLOWED_KEYWORD';

  const stripped = stripCommentsAndStrings(sql);
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(stripped)) return 'BLOCKED_PATTERN';
  }
  return null;
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

/** 요청 핸들러 (테스트용 export) */
export const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  // GET /health — 헬스체크 (최소 정보만 반환, 인증 불필요)
  if (req.method === 'GET' && req.url === '/health') {
    try {
      await query('SELECT 1');
      jsonResponse(res, 200, { ok: true });
    } catch {
      jsonResponse(res, 503, { ok: false });
    }
    return;
  }

  // POST /api/db/query 만 허용 (서버간 호출이므로 CORS 불필요)
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

  // 파라미터 검증
  if (params !== undefined) {
    if (!Array.isArray(params)) {
      jsonResponse(res, 400, { error: 'Invalid params' });
      return;
    }
    if (params.length > MAX_PARAMS) {
      jsonResponse(res, 400, { error: 'Too many params' });
      return;
    }
  }

  // SQL 화이트리스트 검증
  const sqlError = validateProxySQL(text);
  if (sqlError) {
    console.warn(`[DB Proxy] SQL 차단: ${sqlError} — ${text.slice(0, 120)}`);
    jsonResponse(res, 400, { error: 'Query rejected' });
    return;
  }

  // 쿼리 실행
  try {
    const result = await query(text, params);
    jsonResponse(res, 200, { rows: result.rows, rowCount: result.rowCount });
  } catch (err) {
    // 내부 오류 상세는 서버 로그에만 남기고 응답은 일반화
    const message = err instanceof Error ? err.message : 'Query failed';
    console.error('[DB Proxy] 쿼리 오류:', message);
    jsonResponse(res, 500, { error: 'Query failed' });
  }
};

/** DB 프록시 서버 시작 */
export const startDBProxy = (): void => {
  if (!CONFIG.dbProxy.apiKey) {
    console.log('[DB Proxy] DB_PROXY_API_KEY 미설정 — 프록시 서버 비활성화');
    return;
  }
  if (CONFIG.dbProxy.apiKey.length < 32) {
    console.error('[DB Proxy] DB_PROXY_API_KEY는 32자 이상이어야 함 — 프록시 서버 비활성화');
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
