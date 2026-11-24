/**
 * DB 스키마 조회와 캐시.
 */

import { query } from '../db.js';

const SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000; // 5분

// ---- 스키마 캐시 ----

let schemaCache: string | null = null;
let schemaCacheTime = 0;

/** 스키마 캐시 초기화 (테스트용) */
export const clearSchemaCache = (): void => {
  schemaCache = null;
  schemaCacheTime = 0;
};

export const getSchemaInfo = async (tableName?: string): Promise<string> => {
  // 캐시 히트 (테이블 필터 없을 때만)
  if (!tableName && schemaCache && Date.now() - schemaCacheTime < SCHEMA_CACHE_TTL_MS) {
    return schemaCache;
  }

  const tableFilter = tableName ? `AND c.table_name = $1` : '';
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
