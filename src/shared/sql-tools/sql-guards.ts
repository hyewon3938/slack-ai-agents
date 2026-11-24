/**
 * 토큰 단위 보안 검사: 시스템 함수·카탈로그 차단, 키워드 위치 제한, user_id 비교 값 제한.
 */

import type { Token } from './sql-lexer.js';
import { identName, isPunct, isWord } from './sql-blocks.js';

const DANGEROUS_PREFIXES = ['pg_', 'lo_', 'dblink'];
const DANGEROUS_NAMES = new Set([
  'set_config',
  'current_setting',
  'setval',
  'nextval',
  'loread',
  'lowrite',
  'ts_stat',
  'ts_rewrite',
  'crosstab',
  'connectby',
  'inet_server_addr',
  'inet_server_port',
  'inet_client_addr',
  // 읽기 전용 트랜잭션 안에서도 세션·저장 상태를 바꾸는 함수
  'setseed',
  'txid_current',
  'pg_current_xact_id',
  'gin_clean_pending_list',
  'brin_summarize_new_values',
  'brin_summarize_range',
  'brin_desummarize_range',
]);

const isDangerousName = (name: string): boolean => {
  const lower = name.toLowerCase();
  return (
    DANGEROUS_NAMES.has(lower) ||
    DANGEROUS_PREFIXES.some((p) => lower.startsWith(p)) ||
    lower.includes('_to_xml')
  );
};

/** 시스템 카탈로그·서버 함수·문자열 SQL 실행 함수를 쓰면 에러 메시지 */
export const findDangerousIdentifier = (tokens: Token[]): string | null => {
  const hit = tokens.find((t) => {
    const name = identName(t);
    return name !== null && isDangerousName(name);
  });
  return hit ? `보안 규칙: 시스템 함수나 시스템 카탈로그(${hit.value})는 사용할 수 없어.` : null;
};

const READ_ONLY_BLOCKED = new Set(['insert', 'update', 'delete', 'merge', 'into', 'truncate', 'copy']);

/** query_db: 데이터 변경·결과 저장 키워드는 어디에도 올 수 없다 */
export const findWriteKeyword = (tokens: Token[]): string | null => {
  const hit = tokens.find((t) => t.kind === 'word' && READ_ONLY_BLOCKED.has(t.value));
  if (!hit) return null;
  return `query_db는 조회만 할 수 있어. ${hit.value.toUpperCase()}는 쓸 수 없어.`;
};

const SINGLE_USE = new Set(['insert', 'delete', 'merge', 'truncate']);

/** modify_db: 변경 키워드는 문장 맨 앞(과 ON CONFLICT DO UPDATE)에만 올 수 있다 */
export const findExtraWriteKeyword = (tokens: Token[]): string | null => {
  const first = tokens[0]?.value ?? '';
  const hit = tokens.find((t, i) => {
    if (t.kind !== 'word' || i === 0) return false;
    if (SINGLE_USE.has(t.value)) return true;
    if (t.value === 'update') return !isWord(tokens[i - 1], 'do');
    if (t.value === 'into') return !(i === 1 && first === 'insert');
    return false;
  });
  if (!hit) return null;
  return `modify_db는 한 문장에 변경 하나만 실행할 수 있어. (${hit.value.toUpperCase()} 위치 확인)`;
};

// ---- user_id 비교 값 ----

const COMPARE_WORDS = new Set([
  'in',
  'is',
  'between',
  'like',
  'ilike',
  'not',
  'similar',
  'isnull',
  'notnull',
  'collate',
]);

const isLiteral = (t: Token | undefined): boolean =>
  t?.kind === 'string' || t?.kind === 'param' || t?.kind === 'number';

const isOtherLiteral = (t: Token | undefined, userId: number): boolean =>
  isLiteral(t) && !(t?.kind === 'number' && t.value === String(userId));

/** i 위치 user_id 컬럼 참조가 N 이외의 값과 비교되는지 */
const comparesOtherValue = (tokens: Token[], i: number, userId: number): boolean => {
  const start = isPunct(tokens[i - 1], '.') ? i - 2 : i;
  const next = tokens[i + 1];
  const prev = tokens[start - 1];
  if (next?.kind === 'op') {
    return next.value !== '=' || isOtherLiteral(tokens[i + 2], userId);
  }
  if (next?.kind === 'word' && COMPARE_WORDS.has(next.value)) return true;
  if (prev?.kind === 'op') {
    return prev.value !== '=' || isOtherLiteral(tokens[start - 2], userId);
  }
  return false;
};

export const otherUserMessage = (userId: number): string =>
  `보안 규칙: user_id = ${userId}만 허용돼. 다른 user_id 값은 사용할 수 없어.`;

/** user_id를 N 이외의 값과 비교하면 에러 메시지 */
export const findOtherUserValue = (tokens: Token[], userId: number): string | null => {
  const hit = tokens.some(
    (t, i) =>
      identName(t) === 'user_id' &&
      !isPunct(tokens[i + 1], '.') &&
      !isWord(tokens[i - 1], 'as') &&
      comparesOtherValue(tokens, i, userId),
  );
  return hit ? otherUserMessage(userId) : null;
};
