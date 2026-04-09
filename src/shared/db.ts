import pg from 'pg';

const { Pool, types } = pg;

// pg 드라이버가 DATE/TIMESTAMP를 JavaScript Date 객체로 변환하면
// JSON.stringify 시 '2026-03-08T15:00:00.000Z' 같은 UTC 타임스탬프가 되어
// LLM이 날짜를 오해함. 원본 문자열 그대로 반환하도록 설정.
types.setTypeParser(1082, (val: string) => val);  // DATE → 'YYYY-MM-DD'
types.setTypeParser(1114, (val: string) => val);  // TIMESTAMP
types.setTypeParser(1184, (val: string) => val);  // TIMESTAMPTZ

let pool: pg.Pool | null = null;

/** PostgreSQL 연결 풀 초기화 */
export const connectDB = async (databaseUrl: string): Promise<void> => {
  if (pool) {
    console.warn('[DB] 이미 연결되어 있습니다');
    return;
  }

  const useSSL = databaseUrl.includes('sslmode=require');
  pool = new Pool({
    connectionString: databaseUrl,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ...(useSSL && { ssl: { rejectUnauthorized: false } }),
  });

  const client = await pool.connect();
  client.release();
  console.log('[DB] PostgreSQL 연결 완료');
};

/** 연결 풀 반환 (미연결 시 에러) */
const getPool = (): pg.Pool => {
  if (!pool) {
    throw new Error('[DB] 연결되지 않음. connectDB()를 먼저 호출하세요.');
  }
  return pool;
};

/** SQL 쿼리 실행 */
export const query = async <T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> => {
  return getPool().query<T>(text, params);
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
    await client.query(`SET statement_timeout = '${timeoutMs}'`);
    const result = await client.query<T>(text);
    return result;
  } finally {
    await client.query(`SET statement_timeout = '0'`).catch(() => {/* 무시 */});
    client.release();
  }
};

/** 트랜잭션 내 쿼리 실행 — rowCount가 maxRows 초과 시 ROLLBACK (SQL 도구 보안용) */
export const queryWithRowLimit = async <T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  timeoutMs: number,
  maxRows: number,
): Promise<pg.QueryResult<T>> => {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query(`SET statement_timeout = '${timeoutMs}'`);
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
    await client.query('ROLLBACK').catch(() => {/* 무시 */});
    throw err;
  } finally {
    await client.query(`SET statement_timeout = '0'`).catch(() => {/* 무시 */});
    client.release();
  }
};

/** 연결 풀 종료 */
export const disconnectDB = async (): Promise<void> => {
  if (!pool) return;
  await pool.end();
  pool = null;
  console.log('[DB] PostgreSQL 연결 해제');
};
