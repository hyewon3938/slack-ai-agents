/** JSON 본문을 담은 요청을 보낸다. 응답 확인과 에러 처리는 호출부가 한다. */
export function sendJson(
  url: string,
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  body: unknown,
): Promise<Response> {
  return fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
