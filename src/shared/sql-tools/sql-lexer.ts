/**
 * SQL 토크나이저: PostgreSQL 어휘 규칙을 따라 문자열·주석·달러 인용을 구분한다.
 * 보안 검증이 DB와 같은 경계로 SQL을 읽도록, 애매한 입력은 해석하지 않고 실패로 돌려준다.
 */

export type TokenKind = 'word' | 'qident' | 'number' | 'string' | 'param' | 'op' | 'punct';

export interface Token {
  kind: TokenKind;
  /** word는 ASCII 소문자로 정규화, qident는 따옴표 안 이름, string은 원문 내용 */
  value: string;
  /** 달러 인용 문자열 여부 */
  dollar?: boolean;
}

export type LexResult = { ok: true; tokens: Token[] } | { ok: false; reason: string };

const WHITESPACE = new Set([' ', '\t', '\n', '\r', '\f', '\v']);
const OP_CHARS = new Set([...'+-*/<>=~!@#%^&|`?']);
const OP_SPECIAL = /[~!@#%^&|`?]/;
const PUNCT = new Set(['(', ')', ',', ';', '.', '[', ']']);

const isIdentStart = (c: string): boolean => /[A-Za-z_]/.test(c) || c >= '\u0080';
const isIdentCont = (c: string): boolean => /[A-Za-z0-9_$]/.test(c) || c >= '\u0080';
const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';
const asciiLower = (s: string): string => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

type Step = { end: number; token?: Token } | { error: string };

/** 블록 주석 (중첩 허용) */
const scanBlockComment = (sql: string, start: number): Step => {
  let depth = 0;
  let i = start;
  while (i < sql.length) {
    if (sql.startsWith('/*', i)) {
      depth += 1;
      i += 2;
    } else if (sql.startsWith('*/', i)) {
      depth -= 1;
      i += 2;
      if (depth === 0) return { end: i };
    } else {
      i += 1;
    }
  }
  return { error: '닫히지 않은 주석' };
};

/** 작은따옴표 문자열. backslash=true면 E'' 규칙, doubled=false면 b''/x'' 규칙 */
const scanQuoted = (sql: string, start: number, backslash: boolean, doubled: boolean): Step => {
  let i = start + 1;
  let value = '';
  while (i < sql.length) {
    const c = sql[i] ?? '';
    if (backslash && c === '\\') {
      value += sql.slice(i, i + 2);
      i += 2;
    } else if (c === "'") {
      if (doubled && sql[i + 1] === "'") {
        value += "'";
        i += 2;
      } else {
        return { end: i + 1, token: { kind: 'string', value } };
      }
    } else {
      value += c;
      i += 1;
    }
  }
  return { error: '닫히지 않은 문자열' };
};

/** 큰따옴표 식별자 */
const scanQuotedIdent = (sql: string, start: number): Step => {
  let i = start + 1;
  let value = '';
  while (i < sql.length) {
    if (sql[i] === '"') {
      if (sql[i + 1] === '"') {
        value += '"';
        i += 2;
        continue;
      }
      if (value.length === 0) return { error: '빈 식별자' };
      return { end: i + 1, token: { kind: 'qident', value } };
    }
    value += sql[i] ?? '';
    i += 1;
  }
  return { error: '닫히지 않은 식별자' };
};

/** $1 파라미터 또는 $tag$ 달러 인용 */
const scanDollar = (sql: string, start: number): Step => {
  if (isDigit(sql[start + 1])) {
    let i = start + 1;
    while (isDigit(sql[i])) i += 1;
    return { end: i, token: { kind: 'param', value: sql.slice(start, i) } };
  }
  let i = start + 1;
  if (i < sql.length && sql[i] !== '$') {
    if (!isIdentStart(sql[i] ?? '')) return { error: '알 수 없는 $ 표기' };
    while (i < sql.length && sql[i] !== '$' && isIdentCont(sql[i] ?? '')) i += 1;
  }
  if (sql[i] !== '$') return { error: '알 수 없는 $ 표기' };
  const tag = sql.slice(start, i + 1);
  const close = sql.indexOf(tag, i + 1);
  if (close < 0) return { error: '닫히지 않은 달러 인용 문자열' };
  const value = sql.slice(i + 1, close);
  return { end: close + tag.length, token: { kind: 'string', value, dollar: true } };
};

/** 숫자: 뒤에 붙은 영숫자까지 한 토큰으로 묶어 값 비교를 원문 그대로 한다 */
const scanNumber = (sql: string, start: number): Step => {
  let i = start;
  while (i < sql.length) {
    const c = sql[i] ?? '';
    const prev = sql[i - 1] ?? '';
    if (/[0-9A-Za-z_.]/.test(c)) i += 1;
    else if ((c === '+' || c === '-') && /[eE]/.test(prev) && i > start) i += 1;
    else break;
  }
  return { end: i, token: { kind: 'number', value: sql.slice(start, i) } };
};

/** 연산자: PostgreSQL처럼 주석 시작 전에서 끊고 끝의 +/-는 떼어낸다 */
const scanOperator = (sql: string, start: number): Step => {
  let i = start;
  while (i < sql.length && OP_CHARS.has(sql[i] ?? '')) {
    if (i > start && (sql.startsWith('--', i) || sql.startsWith('/*', i))) break;
    i += 1;
  }
  let op = sql.slice(start, i);
  while (op.length > 1 && /[+-]$/.test(op) && !OP_SPECIAL.test(op)) op = op.slice(0, -1);
  return { end: start + op.length, token: { kind: 'op', value: op } };
};

/** 식별자 또는 접두 문자열(E'', B'', X'', N'') */
const scanWord = (sql: string, start: number): Step => {
  let i = start;
  while (i < sql.length && isIdentCont(sql[i] ?? '')) i += 1;
  const word = sql.slice(start, i);
  const lower = asciiLower(word);
  if (sql[i] === "'" && lower.length === 1) {
    if (lower === 'e') return scanQuoted(sql, i, true, true);
    if (lower === 'n') return scanQuoted(sql, i, false, true);
    if (lower === 'b' || lower === 'x') return scanQuoted(sql, i, false, false);
  }
  if (lower === 'u' && sql[i] === '&') return { error: '유니코드 이스케이프 표기는 쓸 수 없어' };
  return { end: i, token: { kind: 'word', value: lower } };
};

const scanOne = (sql: string, i: number): Step => {
  const c = sql[i] ?? '';
  if (WHITESPACE.has(c)) return { end: i + 1 };
  if (sql.startsWith('--', i)) {
    let j = i;
    while (j < sql.length && sql[j] !== '\n' && sql[j] !== '\r') j += 1;
    return { end: j };
  }
  if (sql.startsWith('/*', i)) return scanBlockComment(sql, i);
  if (c === "'") return scanQuoted(sql, i, false, true);
  if (c === '"') return scanQuotedIdent(sql, i);
  if (c === '$') return scanDollar(sql, i);
  if (isDigit(c) || (c === '.' && isDigit(sql[i + 1]))) return scanNumber(sql, i);
  if (sql.startsWith('::', i)) return { end: i + 2, token: { kind: 'op', value: '::' } };
  if (c === ':') return { end: i + 1, token: { kind: 'punct', value: ':' } };
  if (PUNCT.has(c)) return { end: i + 1, token: { kind: 'punct', value: c } };
  if (OP_CHARS.has(c)) return scanOperator(sql, i);
  if (isIdentStart(c)) return scanWord(sql, i);
  return { error: '해석할 수 없는 문자' };
};

/** 괄호 짝 검사 */
const isBalanced = (tokens: Token[]): boolean => {
  const stack: string[] = [];
  for (const t of tokens) {
    if (t.kind !== 'punct') continue;
    if (t.value === '(' || t.value === '[') stack.push(t.value === '(' ? ')' : ']');
    else if (t.value === ')' || t.value === ']') {
      if (stack.pop() !== t.value) return false;
    }
  }
  return stack.length === 0;
};

/** SQL을 토큰 목록으로 분해. 닫히지 않은 문자열·주석·괄호는 실패로 돌려준다 */
export const tokenize = (sql: string): LexResult => {
  const tokens: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const step = scanOne(sql, i);
    if ('error' in step) return { ok: false, reason: step.error };
    if (step.token) tokens.push(step.token);
    i = step.end;
  }
  if (!isBalanced(tokens)) return { ok: false, reason: '괄호 짝이 맞지 않음' };
  return { ok: true, tokens };
};

/** 세미콜론 뒤에 다른 토큰이 이어지면 복수 문장 */
export const hasStatementAfterSemicolon = (tokens: Token[]): boolean => {
  const idx = tokens.findIndex((t) => t.kind === 'punct' && t.value === ';');
  return idx >= 0 && idx < tokens.length - 1;
};

/** 끝의 세미콜론 하나를 뗀 토큰 목록 */
export const withoutTrailingSemicolon = (tokens: Token[]): Token[] => {
  const last = tokens[tokens.length - 1];
  return last?.kind === 'punct' && last.value === ';' ? tokens.slice(0, -1) : tokens;
};

/** 패턴 검사용 텍스트: 문자열 내용은 비우고 식별자·키워드만 남긴다 */
export const maskedText = (tokens: Token[]): string =>
  tokens
    .map((t) => {
      if (t.kind === 'string') return t.dollar ? '$$' : "''";
      return t.value;
    })
    .join(' ');
