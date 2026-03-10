import pg from 'pg';

const { Pool, types } = pg;

// DATE/TIMESTAMP를 문자열 그대로 반환 (JavaScript Date 변환 방지)
types.setTypeParser(1082, (val: string) => val); // DATE → 'YYYY-MM-DD'
types.setTypeParser(1114, (val: string) => val); // TIMESTAMP
types.setTypeParser(1184, (val: string) => val); // TIMESTAMPTZ

let pool: pg.Pool | null = null;

const getPool = (): pg.Pool => {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return pool;
};

export const query = async <T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> => {
  return getPool().query<T>(text, params);
};

export const queryOne = async <T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T | null> => {
  const result = await query<T>(text, params);
  return result.rows[0] ?? null;
};
