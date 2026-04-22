import type { LLMToolDefinition } from './llm.js';
import { query, queryWithClient, queryWithRowLimit, dryRunQuery } from './db.js';
import { createPendingModify } from './pending-modify.js';

// ---- 상수 ----

const SQL_TIMEOUT_MS = 10_000;
const SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000; // 5분
const MAX_MODIFY_ROWS = 50; // 한 번에 변경 가능한 최대 행 수

// ---- SQL 도구 정의 ----

const QUERY_DB_TOOL: LLMToolDefinition = {
  name: 'query_db',
  description:
    'Execute a read-only SQL query. Only SELECT/WITH statements are allowed. Returns { rows, rowCount }.',
  inputSchema: {
    type: 'object',
    properties: {
      sql: {
        type: 'string',
        description: 'SQL SELECT query to execute',
      },
    },
    required: ['sql'],
  },
};

const MODIFY_DB_TOOL: LLMToolDefinition = {
  name: 'modify_db',
  description:
    'Execute INSERT, UPDATE, or DELETE. Returns { rowCount, rows }. Use RETURNING clause to get modified rows. DROP/TRUNCATE/ALTER are blocked.',
  inputSchema: {
    type: 'object',
    properties: {
      sql: {
        type: 'string',
        description: 'SQL INSERT, UPDATE, or DELETE query',
      },
    },
    required: ['sql'],
  },
};

const GET_SCHEMA_TOOL: LLMToolDefinition = {
  name: 'get_schema',
  description:
    'Get database schema: tables, columns, types, constraints. Optionally filter by table name.',
  inputSchema: {
    type: 'object',
    properties: {
      table_name: {
        type: 'string',
        description: 'Optional: filter to a specific table',
      },
    },
  },
};

/** SQL 도구 목록 */
export const SQL_TOOLS: LLMToolDefinition[] = [
  QUERY_DB_TOOL,
  MODIFY_DB_TOOL,
  GET_SCHEMA_TOOL,
];

// ---- SQL 검증 ----

/** SQL에서 주석과 문자열 리터럴 제거 (보안 검증용 공통 유틸) */
const stripCommentsAndStrings = (sql: string): string =>
  sql
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/--[^\n]*/g, '')         // line comments
    .replace(/'[^']*'/g, '')          // single-quoted strings
    .replace(/"[^"]*"/g, '');         // double-quoted strings

/** SQL 앞쪽 주석 제거 후 첫 키워드 추출 */
export const extractFirstKeyword = (sql: string): string => {
  const cleaned = sql
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/--[^\n]*/g, '') // line comments
    .trim();
  const match = /^(\w+)/i.exec(cleaned);
  return (match?.[1] ?? '').toUpperCase();
};

/**
 * SQL에서 주 대상 테이블명 추출 (첫 FROM/UPDATE/INTO 뒤).
 * 여러 테이블이면 첫 번째만 반환. 소문자로 정규화.
 */
export const extractTargetTable = (sql: string): string | null => {
  const stripped = stripCommentsAndStrings(sql);
  const match = /\b(?:FROM|UPDATE|INTO)\s+(\w+)/i.exec(stripped);
  return match?.[1]?.toLowerCase() ?? null;
};

/**
 * DELETE/UPDATE 쿼리에 RETURNING 절이 없으면 `RETURNING *`을 자동 삽입.
 * 세미콜론이 있으면 그 앞에 삽입.
 * 이미 RETURNING이 있으면 원본 그대로 반환.
 */
export const ensureReturningClause = (sql: string): string => {
  const stripped = stripCommentsAndStrings(sql);
  if (/\bRETURNING\b/i.test(stripped)) return sql;

  const trimmed = sql.trimEnd();
  if (trimmed.endsWith(';')) {
    return `${trimmed.slice(0, -1)} RETURNING *;`;
  }
  return `${trimmed} RETURNING *`;
};

/** 복수 SQL 문 감지 (주석·문자열 리터럴 내 세미콜론 제외) */
export const hasMultipleStatements = (sql: string): boolean => {
  const stripped = stripCommentsAndStrings(sql);
  const parts = stripped.split(';').filter((s) => s.trim().length > 0);
  return parts.length > 1;
};

const DANGEROUS_DDL = new Set([
  'DROP',
  'TRUNCATE',
  'ALTER',
  'CREATE',
  'GRANT',
  'REVOKE',
]);

/** SELECT 쿼리 검증. 통과 시 null, 실패 시 에러 메시지 반환 */
export const validateSelectQuery = (sql: string): string | null => {
  if (hasMultipleStatements(sql)) {
    return '여러 SQL 문은 실행할 수 없어. 하나씩 실행해줘.';
  }
  const keyword = extractFirstKeyword(sql);
  if (keyword !== 'SELECT' && keyword !== 'WITH') {
    return `query_db는 SELECT/WITH 쿼리만 실행할 수 있어. (입력: ${keyword})`;
  }
  return null;
};

/** DELETE/UPDATE 문에 WHERE 절이 있는지 검증 */
export const hasWhereClause = (sql: string): boolean => {
  const stripped = stripCommentsAndStrings(sql);
  return /\bWHERE\b/i.test(stripped);
};

/** 변경 쿼리 검증. 통과 시 null, 실패 시 에러 메시지 반환 */
export const validateModifyQuery = (sql: string): string | null => {
  if (hasMultipleStatements(sql)) {
    return '여러 SQL 문은 실행할 수 없어. 하나씩 실행해줘.';
  }
  const keyword = extractFirstKeyword(sql);
  if (DANGEROUS_DDL.has(keyword)) {
    return `${keyword} 문은 안전상 실행할 수 없어.`;
  }
  const ALLOWED = new Set(['INSERT', 'UPDATE', 'DELETE']);
  if (!ALLOWED.has(keyword)) {
    return `modify_db는 INSERT/UPDATE/DELETE만 실행할 수 없어. (입력: ${keyword})`;
  }
  if ((keyword === 'DELETE' || keyword === 'UPDATE') && !hasWhereClause(sql)) {
    return `${keyword} 문에는 반드시 WHERE 절이 필요해. 전체 행 변경은 허용되지 않아.`;
  }
  return null;
};

// ---- 스키마 캐시 ----

let schemaCache: string | null = null;
let schemaCacheTime = 0;

/** 스키마 캐시 초기화 (테스트용) */
export const clearSchemaCache = (): void => {
  schemaCache = null;
  schemaCacheTime = 0;
};

const getSchemaInfo = async (tableName?: string): Promise<string> => {
  // 캐시 히트 (테이블 필터 없을 때만)
  if (
    !tableName &&
    schemaCache &&
    Date.now() - schemaCacheTime < SCHEMA_CACHE_TTL_MS
  ) {
    return schemaCache;
  }

  const tableFilter = tableName
    ? `AND c.table_name = $1`
    : '';
  const params = tableName ? [tableName] : undefined;

  const result = await query<{
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
    constraint_type: string | null;
  }>(
    `SELECT
      c.table_name,
      c.column_name,
      c.data_type,
      c.is_nullable,
      c.column_default,
      tc.constraint_type
    FROM information_schema.columns c
    LEFT JOIN information_schema.key_column_usage kcu
      ON c.table_name = kcu.table_name
      AND c.column_name = kcu.column_name
      AND c.table_schema = kcu.table_schema
    LEFT JOIN information_schema.table_constraints tc
      ON kcu.constraint_name = tc.constraint_name
      AND kcu.table_schema = tc.table_schema
    WHERE c.table_schema = 'public'
      ${tableFilter}
    ORDER BY c.table_name, c.ordinal_position`,
    params,
  );

  const output = JSON.stringify(result.rows, null, 2);

  if (!tableName) {
    schemaCache = output;
    schemaCacheTime = Date.now();
  }

  return output;
};

// ---- 보안 검증 ----

/** user_id 컬럼이 없는 테이블 (user_id 필터 검증 면제) */
const USER_ID_EXEMPT_TABLES = new Set([
  'sleep_events',
  'notification_settings',
  'categories',
  'reminders',
]);

/**
 * SQL에 user_id = {userId} 필터가 정확히 포함되어 있는지 검증.
 * - SELECT/UPDATE/DELETE: user_id = {userId} 조건 필수 (다른 user_id 값 차단)
 * - INSERT: user_id 컬럼 포함 여부 확인
 * - 면제 테이블만 참조하는 쿼리 및 information_schema 쿼리는 통과.
 * 통과 시 null, 실패 시 에러 메시지 반환.
 */
export const validateUserIdFilter = (sql: string, userId: number): string | null => {
  const stripped = stripCommentsAndStrings(sql);

  // information_schema 쿼리는 OK (get_schema 도구용)
  if (/\binformation_schema\b/i.test(stripped)) return null;

  // FROM/JOIN/INTO/UPDATE 뒤의 테이블명 추출
  const tableMatches = stripped.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi);
  const tables = [...tableMatches].map((m) => (m[1] ?? '').toLowerCase());

  // 테이블 참조가 없는 순수 계산 쿼리는 OK (SELECT EXTRACT(...), SELECT 470 등)
  if (tables.length === 0) return null;

  // 추출된 테이블이 모두 면제 대상이면 OK
  if (tables.every((t) => USER_ID_EXEMPT_TABLES.has(t))) {
    return null;
  }

  const keyword = extractFirstKeyword(stripped);

  // INSERT: user_id 컬럼이 포함되어야 함
  if (keyword === 'INSERT') {
    if (/\buser_id\b/i.test(stripped)) return null;
    return '보안 규칙: INSERT에 user_id 컬럼을 포함해줘.';
  }

  // SELECT/UPDATE/DELETE: user_id = {userId} 정확히 매칭 (다른 숫자 차단)
  const exactPattern = new RegExp(`\\buser_id\\s*=\\s*${userId}\\b`, 'i');
  if (exactPattern.test(stripped)) return null;

  // user_id = (다른 값) 시도 감지
  if (/\buser_id\s*=/i.test(stripped)) {
    return `보안 규칙: user_id = ${userId}만 허용돼. 다른 user_id 값은 사용할 수 없어.`;
  }

  return `보안 규칙: 이 쿼리에는 user_id = ${userId} 조건이 필요해.`;
};

/** custom_instructions INSERT 시 시스템 프롬프트 우회 시도 감지 */
const DANGEROUS_INSTRUCTION_PATTERNS = [
  /ignore\s+(previous|all|above|system)/i,
  /disregard/i,
  /override\s+(system|rule|instruction)/i,
  /forget\s+(previous|all|everything)/i,
  /you\s+are\s+now/i,
  /new\s+instructions?:/i,
];

/**
 * custom_instructions 테이블 INSERT 시 위험 키워드 감지.
 * 통과 시 null, 실패 시 에러 메시지 반환.
 */
export const validateCustomInstruction = (sql: string): string | null => {
  if (!/\bcustom_instructions\b/i.test(sql)) return null;
  if (!/\bINSERT\b/i.test(sql)) return null;

  // 문자열 리터럴 내용 추출
  const literals = [...sql.matchAll(/'([^']*)'/g)].map((m) => m[1] ?? '');
  for (const literal of literals) {
    for (const pattern of DANGEROUS_INSTRUCTION_PATTERNS) {
      if (pattern.test(literal)) {
        return '보안 경고: 지시사항에 시스템 규칙을 우회하려는 표현이 포함되어 있어 등록할 수 없어.';
      }
    }
  }
  return null;
};

// ---- Post-modify 훅 ----

export type PostModifyHook = (sql: string) => void | Promise<void>;

let postModifyHook: PostModifyHook | null = null;

/** modify_db 실행 후 호출될 훅 등록 */
export const setPostModifyHook = (hook: PostModifyHook): void => {
  postModifyHook = hook;
};

// ---- Confirm card sender ----

export interface SQLToolContext {
  slackUserId?: string;
  slackChannel?: string;
  slackThreadTs?: string;
}

export type ConfirmCardSender = (params: {
  token: string;
  operation: 'DELETE' | 'UPDATE';
  tableName: string | null;
  rowCount: number;
  rows: Array<Record<string, unknown>>;
  context: SQLToolContext & { userId: number };
}) => Promise<void>;

let confirmCardSender: ConfirmCardSender | null = null;

/** 확인 카드 전송 함수 주입. app.ts에서 Slack client 바인딩하여 호출 */
export const setConfirmCardSender = (sender: ConfirmCardSender): void => {
  confirmCardSender = sender;
};

/** 테스트용: sender 해제 */
export const clearConfirmCardSender = (): void => {
  confirmCardSender = null;
};

// ---- 감사 로그 ----

/** SQL 실행 로그 (도구명, SQL 앞부분, 결과 요약) */
const logSQLExecution = (tool: string, sql: string, result: { rowCount?: number | null; error?: string }): void => {
  const truncatedSQL = sql.length > 200 ? sql.slice(0, 200) + '...' : sql;
  if (result.error) {
    console.warn(`[SQL Audit] BLOCKED ${tool}: ${truncatedSQL} → ${result.error}`);
  } else {
    console.log(`[SQL Audit] ${tool}: ${truncatedSQL} → ${result.rowCount ?? 0} rows`);
  }
};

// ---- SQL 도구 실행기 ----

/**
 * SQL 도구 실행기.
 * agent-loop의 executeToolCall 시그니처: (name, args) => Promise<string>
 * userId: 현재 사용자의 DB user_id (기본값 1)
 * context: Slack 채널/스레드 정보 (modify_db 확인 카드 전송용)
 */
export const executeSQLTool = async (
  name: string,
  args: Record<string, unknown>,
  userId: number = 1,
  context?: SQLToolContext,
): Promise<string> => {
  switch (name) {
    case 'query_db': {
      const sql = args['sql'] as string;
      const error = validateSelectQuery(sql) ?? validateUserIdFilter(sql, userId);
      if (error) {
        logSQLExecution('query_db', sql, { error });
        return JSON.stringify({ error });
      }

      const result = await queryWithClient(sql, SQL_TIMEOUT_MS);
      logSQLExecution('query_db', sql, { rowCount: result.rowCount });
      return JSON.stringify({ rows: result.rows, rowCount: result.rowCount });
    }

    case 'modify_db': {
      const sql = args['sql'] as string;
      const error = validateModifyQuery(sql) ?? validateUserIdFilter(sql, userId) ?? validateCustomInstruction(sql);
      if (error) {
        logSQLExecution('modify_db', sql, { error });
        return JSON.stringify({ error });
      }

      // DELETE/UPDATE: 영향 row 수가 임계치 이상이면 확인 카드로 전환
      const keyword = extractFirstKeyword(sql);
      if ((keyword === 'DELETE' || keyword === 'UPDATE') && confirmCardSender) {
        const threshold = Number(process.env['MODIFY_CONFIRM_THRESHOLD'] ?? 3);
        const sqlWithReturning = ensureReturningClause(sql);

        let dryRun: Awaited<ReturnType<typeof dryRunQuery>>;
        try {
          dryRun = await dryRunQuery(sqlWithReturning, SQL_TIMEOUT_MS);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          logSQLExecution('modify_db', sql, { error: `dry-run 실패: ${msg}` });
          return JSON.stringify({ error: `쿼리 검증 실패: ${msg}` });
        }

        if (dryRun.rowCount >= threshold) {
          const token = await createPendingModify({
            userId,
            sqlText: sqlWithReturning,
            rowCount: dryRun.rowCount,
            slackChannel: context?.slackChannel,
            slackThreadTs: context?.slackThreadTs,
          });

          const tableName = extractTargetTable(sql);

          try {
            await confirmCardSender({
              token,
              operation: keyword,
              tableName,
              rowCount: dryRun.rowCount,
              rows: dryRun.rows,
              context: { userId, ...context },
            });
          } catch (err: unknown) {
            console.error('[SQL Tools] confirm card 전송 실패:', err);
          }

          logSQLExecution('modify_db', sql, { error: `confirm pending (${dryRun.rowCount} rows)` });
          return JSON.stringify({
            pending: true,
            rowCount: dryRun.rowCount,
            message: `${dryRun.rowCount}개 행이 변경될 예정이야. Slack 확인 카드에서 실행/취소해줘.`,
          });
        }
      }

      // 즉시 실행 경로 (INSERT 전체, 또는 DELETE/UPDATE 중 영향 row < threshold)
      const result = await queryWithRowLimit(sql, SQL_TIMEOUT_MS, MAX_MODIFY_ROWS);
      logSQLExecution('modify_db', sql, { rowCount: result.rowCount });

      // fire-and-forget: 훅 실행 (응답 지연 없음)
      if (postModifyHook) {
        Promise.resolve(postModifyHook(sql)).catch((err: unknown) => {
          console.error('[SQL Tools] post-modify hook 오류:', err);
        });
      }

      return JSON.stringify({ rowCount: result.rowCount, rows: result.rows });
    }

    case 'get_schema': {
      const tableName = args['table_name'] as string | undefined;
      return getSchemaInfo(tableName);
    }

    default:
      return JSON.stringify({ error: `알 수 없는 SQL 도구: ${name}` });
  }
};
