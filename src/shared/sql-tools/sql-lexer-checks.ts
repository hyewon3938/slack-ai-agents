/**
 * 토큰화 뒤 검사: 이름 자리 표시, CASE 위치, 이어 쓴 문자열 리터럴.
 * DB가 다르게 읽을 수 있는 배치는 해석하지 않고 실패로 돌려주기 위한 단계다.
 */

import type { Token } from './sql-lexer.js';

const isWordTok = (t: Token | undefined, value: string): boolean =>
  t?.kind === 'word' && !t.ident && t.value === value;
const isPunctTok = (t: Token | undefined, value: string): boolean =>
  t?.kind === 'punct' && t.value === value;

// ---- 이름 자리 표시 ----

/** CTE의 AS [NOT] MATERIALIZED ( 는 이름이 아니라 키워드 */
const isCteMaterialized = (tokens: Token[], i: number): boolean => {
  const at = isWordTok(tokens[i], 'not') ? i + 1 : i;
  return isWordTok(tokens[at], 'materialized') && isPunctTok(tokens[at + 1], '(');
};

/** `.` 뒤와 AS 뒤의 word는 DB가 키워드가 아닌 이름(컬럼·별칭)으로 읽는다 */
export const markNameWords = (tokens: Token[]): void => {
  tokens.forEach((t, i) => {
    if (t.kind !== 'word') return;
    const prev = tokens[i - 1];
    if (isPunctTok(prev, '.')) t.ident = true;
    else if (isWordTok(prev, 'as') && !isCteMaterialized(tokens, i)) t.ident = true;
  });
};

// ---- 이어 쓴 문자열 ----

/**
 * 문자열 리터럴 두 개가 바로 이웃하는지.
 * DB는 줄바꿈을 사이에 둔 두 문자열을 첫 문자열의 규칙으로 이어 읽으므로, 이웃한 문자열은 해석하지 않는다.
 */
export const hasAdjacentStrings = (tokens: Token[]): boolean =>
  tokens.some((t, i) => t.kind === 'string' && tokens[i - 1]?.kind === 'string');

// ---- CASE 위치 ----

/** 바로 뒤에 CASE 식이 올 수 있는 키워드. 이 밖의 자리에서 CASE는 DB가 별칭으로 읽을 수 있다 */
const CASE_AFTER_WORDS = new Set([
  'select', 'distinct', 'all', 'where', 'and', 'or', 'not', 'when', 'then', 'else', 'case',
  'on', 'having', 'returning', 'limit', 'offset', 'symmetric', 'asymmetric', 'like', 'ilike',
  'to', 'from',
]);
const CASE_AFTER_PUNCT = new Set(['(', ',', '[', ':']);

/** 뒤에 식이 이어지는 키워드. 이 뒤의 between은 DB가 컬럼 이름으로 읽을 수 있다 */
const EXPR_PREFIX_WORDS = new Set([
  ...CASE_AFTER_WORDS,
  'between', 'escape', 'similar', 'zone', 'time', 'at', 'local', 'collate', 'is', 'in', 'any',
  'some', 'exists', 'array', 'row', 'unique', 'operator', 'interval', 'overlaps', 'by', 'using',
  'set', 'values', 'fetch', 'first', 'next', 'rows', 'range', 'groups', 'default', 'with', 'into',
  'join', 'lateral', 'only', 'union', 'intersect', 'except', 'group', 'order', 'window',
  'partition', 'over', 'filter', 'variadic', 'as',
]);

/** 닫는 괄호 j의 여는 괄호 위치 */
const openerOf = (tokens: Token[], j: number): number => {
  let depth = 0;
  for (let k = j; k >= 0; k -= 1) {
    if (isPunctTok(tokens[k], ')')) depth += 1;
    else if (isPunctTok(tokens[k], '(')) depth -= 1;
    if (depth === 0) return k;
  }
  return -1;
};

/** j 위치 토큰이 식의 끝인지. 애매하면 false */
const isOperandEnd = (tokens: Token[], j: number): boolean => {
  const t = tokens[j];
  if (!t) return false;
  if (t.kind === 'number' || t.kind === 'string' || t.kind === 'param' || t.kind === 'qident') {
    return true;
  }
  if (t.kind === 'word') return t.ident === true || !EXPR_PREFIX_WORDS.has(t.value);
  if (isPunctTok(t, ']')) return true;
  if (!isPunctTok(t, ')')) return false;
  const before = tokens[openerOf(tokens, j) - 1];
  return !['operator', 'on', 'values', 'using'].some((w) => isWordTok(before, w));
};

/** i 위치 BETWEEN이 연산자로만 읽히는 자리인지: 앞(NOT 앞)이 식의 끝이어야 한다 */
const isBetweenOperator = (tokens: Token[], i: number): boolean =>
  isOperandEnd(tokens, i - 1) || (isWordTok(tokens[i - 1], 'not') && isOperandEnd(tokens, i - 2));

/** i 위치 CASE가 식의 시작으로만 읽히는 자리인지 */
const isCaseStart = (tokens: Token[], i: number): boolean => {
  const prev = tokens[i - 1];
  if (!prev) return true;
  if (prev.kind === 'op') return !(prev.value === '*' && isPunctTok(tokens[i - 2], '.'));
  if (prev.kind === 'punct') return CASE_AFTER_PUNCT.has(prev.value);
  if (prev.kind !== 'word' || prev.ident) return false;
  if (prev.value === 'between') return isBetweenOperator(tokens, i - 1);
  if (prev.value === 'zone') return isWordTok(tokens[i - 2], 'time') && isWordTok(tokens[i - 3], 'at');
  if (prev.value !== 'by') return CASE_AFTER_WORDS.has(prev.value);
  const owner = tokens[i - 2];
  return ['group', 'order', 'partition'].some((w) => isWordTok(owner, w));
};

/** CASE마다 식 시작 자리에 있고, 같은 괄호 깊이에서 END로 닫혀야 한다 */
export const hasClearCases = (tokens: Token[]): boolean => {
  const stack: string[] = [];
  for (const [i, t] of tokens.entries()) {
    if (isWordTok(t, 'case')) {
      if (!isCaseStart(tokens, i)) return false;
      stack.push('case');
    } else if (isWordTok(t, 'end') && stack[stack.length - 1] === 'case') {
      stack.pop();
    } else if (isPunctTok(t, '(') || isPunctTok(t, '[')) {
      stack.push('group');
    } else if (isPunctTok(t, ')') || isPunctTok(t, ']')) {
      if (stack.pop() !== 'group') return false;
    }
  }
  return stack.length === 0;
};
