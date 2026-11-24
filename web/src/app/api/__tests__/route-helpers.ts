/** route 핸들러 테스트 공통 헬퍼 — Request와 Next.js 16 route context(params Promise)를 만든다. */

const BASE_URL = 'http://localhost';

export const jsonRequest = (method: string, path: string, body?: unknown): Request =>
  new Request(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export const rawRequest = (method: string, path: string, body: string): Request =>
  new Request(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body,
  });

export const idParams = (id: string): { params: Promise<{ id: string }> } => ({
  params: Promise.resolve({ id }),
});
