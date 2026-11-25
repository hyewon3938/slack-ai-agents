import pg from 'pg';

const { Pool, types } = pg;

// pg 드라이버가 DATE/TIMESTAMP를 JavaScript Date 객체로 변환하면
// JSON.stringify 시 '2026-03-08T15:00:00.000Z' 같은 UTC 타임스탬프가 되어
// LLM이 날짜를 오해함. 원본 문자열 그대로 반환하도록 설정.
types.setTypeParser(1082, (val: string) => val); // DATE → 'YYYY-MM-DD'
types.setTypeParser(1114, (val: string) => val); // TIMESTAMP
types.setTypeParser(1184, (val: string) => val); // TIMESTAMPTZ

let pool: pg.Pool | null = null;
/** SQL 도구 전용 역할로 접속하는 두 번째 풀 (ADR-0067). LLM이 쓴 SQL만 여기서 실행한다 */
let toolPool: pg.Pool | null = null;
/**
 * 도구 풀이 필수인지 (#665). 운영에서는 true라 도구 풀이 없으면 LLM이 쓴 SQL을 기존 풀로 대신 실행하지 않고
 * 거절한다. 로컬 개발과 테스트는 false라 기존 풀로 대신한다.
 */
let toolPoolRequired = false;

/** 도구 풀이 없어 LLM이 쓴 SQL 실행을 거절할 때 던지는 오류 */
export class SqlToolUnavailableError extends Error {
  constructor() {
    super('SQL 도구 전용 연결이 없어 실행하지 않았어. 운영자가 도구 연결 설정을 확인해야 해.');
    this.name = 'SqlToolUnavailableError';
  }
}

/** 도구 풀 필수 여부 설정. 봇 시작 시 도구 풀을 열기 전에 한 번 부른다 */
export const setSqlToolPoolRequired = (required: boolean): void => {
  toolPoolRequired = required;
};

/** 도구 풀이 전용 역할로 열려 있는지. 도구 풀은 권한 동기화가 성공한 뒤에만 열린다 */
export const isSqlToolPoolConnected = (): boolean => toolPool !== null;

/** 도구 풀이 없을 때의 동작을 시작 로그에 붙일 문구 */
export const sqlToolFallbackNote = (): string =>
  toolPoolRequired ? 'SQL 도구 실행을 거절합니다' : 'SQL 도구가 기존 연결 풀을 씁니다';

const createPool = (databaseUrl: string, max: number): pg.Pool => {
  const useSSL = databaseUrl.includes('sslmode=require');
  return new Pool({
    connectionString: databaseUrl,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ...(useSSL && { ssl: { rejectUnauthorized: false } }),
  });
};

/** PostgreSQL 연결 풀 초기화 */
export const connectDB = async (databaseUrl: string): Promise<void> => {
  if (pool) {
    console.warn('[DB] 이미 연결되어 있습니다');
    return;
  }

  pool = createPool(databaseUrl, 5);

  const client = await pool.connect();
  client.release();
  console.log('[DB] PostgreSQL 연결 완료');
};

/**
 * SQL 도구 전용 풀 초기화 (크기 2).
 * 연결 문자열이 없거나 연결에 실패하면 로그를 남기고 풀을 열지 않는다. 그 뒤 도구 SQL은 필수 여부에 따라
 * 기존 풀로 대신하거나 거절된다. 봇 시작은 멈추지 않는다.
 */
export const connectSqlToolDB = async (sqlToolUrl: string): Promise<void> => {
  if (toolPool) {
    console.warn('[DB] SQL 도구 풀이 이미 연결되어 있습니다');
    return;
  }
  if (sqlToolUrl === '') {
    console.warn(`[DB] SQL_TOOL_DATABASE_URL이 없어 ${sqlToolFallbackNote()}`);
    return;
  }

  const candidate = createPool(sqlToolUrl, 2);
  try {
    const client = await candidate.connect();
    client.release();
  } catch (err) {
    await candidate.end().catch(() => {
      /* 무시 */
    });
    console.error(`[DB] SQL 도구 전용 풀 연결 실패, ${sqlToolFallbackNote()}:`, err);
    return;
  }
  toolPool = candidate;
  // eslint-disable-next-line no-console
  console.log('[DB] SQL 도구 전용 풀 연결 완료');
};

/** 연결 풀 반환 (미연결 시 에러) */
const getPool = (): pg.Pool => {
  if (!pool) {
    throw new Error('[DB] 연결되지 않음. connectDB()를 먼저 호출하세요.');
  }
  return pool;
};

/**
 * SQL 도구 풀 반환. 전용 풀이 없으면 필수일 때(운영)는 거절하고, 아닐 때(로컬·테스트)는 기존 풀로 대신한다.
 */
const getToolPool = (): pg.Pool => {
  if (toolPool) return toolPool;
  if (toolPoolRequired) throw new SqlToolUnavailableError();
  return getPool();
};

/**
 * 도구 연결의 제한 시간 정리. 0으로 두면 역할 기본값으로 걸어 둔 제한 시간까지 풀리므로
 * RESET으로 역할 기본값에 되돌린다.
 */
const RESET_TIMEOUT = 'RESET statement_timeout';

/** SQL 쿼리 실행 */
export const query = async <T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> => {
  return getPool().query<T>(text, params);
};

/**
 * 트랜잭션 헬퍼 — 콜백 내 client.query들을 BEGIN/COMMIT으로 감싸고 예외 시 ROLLBACK.
 * 파생 테이블 user당 full-replace(DELETE → 다중 INSERT) 등 원자적 다중 쓰기용 (#523 P1).
 */
export const withTransaction = async <T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> => {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {
      /* 무시 */
    });
    throw err;
  } finally {
    client.release();
  }
};

/** SQL 쿼리 실행 후 첫 번째 행 반환 (없으면 null) */
export const queryOne = async <T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T | null> => {
  const result = await query<T>(text, params);
  return result.rows[0] ?? null;
};

/** 전용 클라이언트로 타임아웃 적용 쿼리 실행 (SQL 도구용) */
export const queryWithClient = async <T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  timeoutMs: number,
): Promise<pg.QueryResult<T>> => {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query(`SET statement_timeout = ${Number(timeoutMs)}`);
    const result = await client.query<T>(text);
    return result;
  } finally {
    await client.query('SET statement_timeout = 0').catch(() => {
      /* 무시 */
    });
    client.release();
  }
};

/**
 * 읽기 전용 트랜잭션에서 타임아웃 적용 쿼리 실행 (query_db 조회 도구용, SQL 도구 풀).
 * `SET TRANSACTION READ ONLY`로 DB가 쓰기를 거부하게 하고, 결과와 무관하게 항상 ROLLBACK한다.
 * ROLLBACK이나 타임아웃 복구가 실패한 커넥션은 상태를 알 수 없으므로 풀에 되돌리지 않고 폐기한다.
 */
export const queryReadOnlyWithTimeout = async <T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  timeoutMs: number,
): Promise<pg.QueryResult<T>> => {
  const p = getToolPool();
  const client = await p.connect();
  let cleanupError: Error | undefined;
  const rollback = async (): Promise<void> => {
    try {
      await client.query('ROLLBACK');
    } catch (err) {
      cleanupError ??= err instanceof Error ? err : new Error(String(err));
      throw err;
    }
  };
  try {
    await client.query(`SET statement_timeout = ${Number(timeoutMs)}`);
    await client.query('BEGIN');
    await client.query('SET TRANSACTION READ ONLY');
    const result = await client.query<T>(text);
    await rollback();
    return result;
  } catch (err) {
    await rollback().catch(() => {
      /* 정리 실패는 release에서 처리 */
    });
    throw err;
  } finally {
    await client.query(RESET_TIMEOUT).catch((err: unknown) => {
      cleanupError ??= err instanceof Error ? err : new Error(String(err));
    });
    client.release(cleanupError);
  }
};

/** 트랜잭션 내 쿼리 실행 — rowCount가 maxRows 초과 시 ROLLBACK (modify_db 실행, SQL 도구 풀) */
export const queryWithRowLimit = async <T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  timeoutMs: number,
  maxRows: number,
): Promise<pg.QueryResult<T>> => {
  const p = getToolPool();
  const client = await p.connect();
  try {
    await client.query(`SET statement_timeout = ${Number(timeoutMs)}`);
    await client.query('BEGIN');
    const result = await client.query<T>(text);
    if (result.rowCount !== null && result.rowCount > maxRows) {
      await client.query('ROLLBACK');
      throw new Error(
        `쿼리가 ${result.rowCount}행에 영향 (최대 ${maxRows}행). ROLLBACK 완료. 조건을 더 좁혀줘.`,
      );
    }
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {
      /* 무시 */
    });
    throw err;
  } finally {
    await client.query(RESET_TIMEOUT).catch(() => {
      /* 무시 */
    });
    client.release();
  }
};

/**
 * 읽기 전용 트랜잭션 쿼리 (#477 P5b 게이트 #2, ADR-0040).
 * LLM 자율 신호 SQL 실행 격리용 — `SET TRANSACTION READ ONLY`로 INSERT/UPDATE/DELETE/DDL을
 * PG가 거부(정적 검증 게이트 #1 우회 백스톱) + row cap 초과 시 throw. 항상 ROLLBACK(쓰기 없음).
 * LLM이 쓴 SQL이라 SQL 도구 풀에서 실행한다 (#665).
 */
export const queryReadOnly = async <T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  timeoutMs: number,
  maxRows: number,
): Promise<pg.QueryResult<T>> => {
  const p = getToolPool();
  const client = await p.connect();
  try {
    await client.query(`SET statement_timeout = ${Number(timeoutMs)}`);
    await client.query('BEGIN');
    await client.query('SET TRANSACTION READ ONLY');
    const result = await client.query<T>(text);
    if (result.rowCount !== null && result.rowCount > maxRows) {
      await client.query('ROLLBACK');
      throw new Error(
        `신호 SQL이 ${result.rowCount}행 반환 (최대 ${maxRows}). 단일 숫자 결과여야 함.`,
      );
    }
    await client.query('ROLLBACK'); // 읽기 전용 — 항상 ROLLBACK
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {
      /* 무시 */
    });
    throw err;
  } finally {
    await client.query(RESET_TIMEOUT).catch(() => {
      /* 무시 */
    });
    client.release();
  }
};

export interface DryRunResult {
  rowCount: number;
  rows: Record<string, unknown>[];
}

/**
 * DELETE/UPDATE를 BEGIN → 실행 → ROLLBACK으로 실행해 영향 row 수와 내용을 얻는다.
 * DB 상태는 변경되지 않는다.
 * SQL에 RETURNING이 없으면 "RETURNING *"를 자동 추가한다. SQL 도구 풀에서 실행한다.
 */
export const dryRunAffectedRows = async (
  text: string,
  timeoutMs: number,
): Promise<DryRunResult> => {
  const p = getToolPool();
  const client = await p.connect();
  try {
    await client.query(`SET statement_timeout = ${Number(timeoutMs)}`);
    await client.query('BEGIN');
    const sqlWithReturning = ensureReturningClause(text);
    const result = await client.query(sqlWithReturning);
    await client.query('ROLLBACK');
    return {
      rowCount: result.rowCount ?? 0,
      rows: result.rows as Record<string, unknown>[],
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {
      /* 무시 */
    });
    throw err;
  } finally {
    await client.query(RESET_TIMEOUT).catch(() => {
      /* 무시 */
    });
    client.release();
  }
};

/**
 * SQL 끝부분에 RETURNING이 없으면 "RETURNING *"를 추가.
 * 주석/문자열 리터럴 안의 RETURNING은 무시.
 */
export const ensureReturningClause = (sql: string): string => {
  const stripped = sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
    .replace(/'[^']*'/g, '')
    .replace(/"[^"]*"/g, '');
  if (/\bRETURNING\b/i.test(stripped)) return sql;
  return sql.replace(/;?\s*$/, ' RETURNING *');
};

/** 연결 풀 종료 */
export const disconnectDB = async (): Promise<void> => {
  if (toolPool) {
    await toolPool.end();
    toolPool = null;
  }
  if (!pool) return;
  await pool.end();
  pool = null;
  console.log('[DB] PostgreSQL 연결 해제');
};
