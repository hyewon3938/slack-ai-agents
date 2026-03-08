import type { LLMToolDefinition } from './llm.js';
import { query, queryWithClient } from './db.js';

// ---- 상수 ----

const SQL_TIMEOUT_MS = 10_000;
const SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000; // 5분

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

/** SQL 앞쪽 주석 제거 후 첫 키워드 추출 */
export const extractFirstKeyword = (sql: string): string => {
  const cleaned = sql
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/--[^\n]*/g, '') // line comments
    .trim();
  const match = /^(\w+)/i.exec(cleaned);
  return (match?.[1] ?? '').toUpperCase();
};

/** 복수 SQL 문 감지 (문자열 리터럴 내 세미콜론 제외) */
export const hasMultipleStatements = (sql: string): boolean => {
  const withoutStrings = sql.replace(/'[^']*'/g, '').replace(/"[^"]*"/g, '');
  const parts = withoutStrings.split(';').filter((s) => s.trim().length > 0);
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
    return `modify_db는 INSERT/UPDATE/DELETE만 실행할 수 있어. (입력: ${keyword})`;
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

// ---- Post-modify 훅 ----

export type PostModifyHook = (sql: string) => void | Promise<void>;

let postModifyHook: PostModifyHook | null = null;

/** modify_db 실행 후 호출될 훅 등록 */
export const setPostModifyHook = (hook: PostModifyHook): void => {
  postModifyHook = hook;
};

// ---- SQL 도구 실행기 ----

/**
 * SQL 도구 실행기.
 * agent-loop의 executeToolCall 시그니처: (name, args) => Promise<string>
 */
export const executeSQLTool = async (
  name: string,
  args: Record<string, unknown>,
): Promise<string> => {
  switch (name) {
    case 'query_db': {
      const sql = args['sql'] as string;
      const error = validateSelectQuery(sql);
      if (error) return JSON.stringify({ error });

      const result = await queryWithClient(sql, SQL_TIMEOUT_MS);
      return JSON.stringify({ rows: result.rows, rowCount: result.rowCount });
    }

    case 'modify_db': {
      const sql = args['sql'] as string;
      const error = validateModifyQuery(sql);
      if (error) return JSON.stringify({ error });

      const result = await queryWithClient(sql, SQL_TIMEOUT_MS);

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
