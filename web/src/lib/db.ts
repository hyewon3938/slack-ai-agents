import pg from 'pg';

const { Pool, types } = pg;

// DATE/TIMESTAMP를 문자열 그대로 반환 (JavaScript Date 변환 방지)
types.setTypeParser(1082, (val: string) => val); // DATE → 'YYYY-MM-DD'
types.setTypeParser(1114, (val: string) => val); // TIMESTAMP
types.setTypeParser(1184, (val: string) => val); // TIMESTAMPTZ

let pool: pg.Pool | null = null;

const getPool = (): pg.Pool => {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    const useSSL = connectionString?.includes('sslmode=require');
    pool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ...(useSSL && { ssl: { rejectUnauthorized: false } }),
    });
  }
  return pool;
};

export const query = async <T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> => {
  // Neon free tier cold start 대응: 연결 에러 시 1회 재시도
  try {
    return await getPool().query<T>(text, params);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    const isConnectionError =
      msg.includes('Connection terminated') ||
      msg.includes('connect ETIMEDOUT') ||
      msg.includes('connection refused') ||
      msg.includes('Client has encountered a connection error') ||
      msg.includes('terminating connection') ||
      msg.includes('sorry, too many clients') ||
      msg.includes('ECONNRESET');
    if (isConnectionError) {
      // 풀 리셋 후 재시도
      if (pool) {
        await pool.end().catch(() => {});
        pool = null;
      }
      return getPool().query<T>(text, params);
    }
    throw err;
  }
};

export const queryOne = async <T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T | null> => {
  const result = await query<T>(text, params);
  return result.rows[0] ?? null;
};
