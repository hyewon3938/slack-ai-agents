/** DB 쿼리 결과 타입 (pg.QueryResult 호환) */
export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number | null;
}

const DB_PROXY_URL = process.env['DB_PROXY_URL'] ?? '';
const DB_PROXY_API_KEY = process.env['DB_PROXY_API_KEY'] ?? '';

/** DB 프록시 API 호출 */
const fetchProxy = async <T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> => {
  if (!DB_PROXY_URL) throw new Error('DB_PROXY_URL 환경변수 미설정');

  const res = await fetch(`${DB_PROXY_URL}/api/db/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DB_PROXY_API_KEY}`,
    },
    body: JSON.stringify({ text, params }),
    cache: 'no-store',
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `DB proxy error: ${res.status}`);
  }

  return res.json() as Promise<QueryResult<T>>;
};

/** SQL 쿼리 실행 */
export const query = async <T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> => fetchProxy<T>(text, params);

/** SQL 쿼리 실행 후 첫 번째 행 반환 (없으면 null) */
export const queryOne = async <T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T | null> => {
  const result = await fetchProxy<T>(text, params);
  return result.rows[0] ?? null;
};
