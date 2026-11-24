/**
 * LLM에 노출하는 SQL 도구 정의.
 */

import type { LLMToolDefinition } from '../llm.js';

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
export const SQL_TOOLS: LLMToolDefinition[] = [QUERY_DB_TOOL, MODIFY_DB_TOOL, GET_SCHEMA_TOOL];
