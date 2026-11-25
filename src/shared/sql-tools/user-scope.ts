/**
 * 조회 쿼리의 user_id 범위 분석.
 * FROM으로 읽는 테이블마다, 그 테이블이 속한 SELECT 블록의 WHERE·JOIN 조건이
 * user_id = N을 보장하는지 확인한다. 해석하지 못한 구조는 통과시키지 않는다.
 *
 * 역할별 파일: 공용 규칙·문구(user-scope-rules.ts), FROM 목록 해석(user-scope-from.ts),
 * 범위 보장 확인(user-scope-coverage.ts). 이 파일은 블록 분석을 맡고 나머지를 다시 내보낸다.
 */

import {
  type Ctx,
  type Range,
  afterGroup,
  identName,
  isPunct,
  isWord,
  splitTop,
  topLevel,
} from './sql-blocks.js';
import { requireCoverage } from './user-scope-coverage.js';
import { isStopWord, parseFromList, parseSource } from './user-scope-from.js';
import { MSG, type Scope, type ScopeCtx, fail, startsQuery } from './user-scope-rules.js';

export {
  BLOCKED_TABLES,
  MSG,
  type ScopeCtx,
  SHARED_READONLY_TABLES,
  USER_ID_EXEMPT_TABLES,
  fail,
  startsQuery,
} from './user-scope-rules.js';
export { type JoinKind, type Source, parseFromList, parseSource } from './user-scope-from.js';
export { requireCoverage, uncoveredSources } from './user-scope-coverage.js';

/** 범위 안 모든 괄호 서브쿼리를 찾아 분석 */
export const scanGroups = (ctx: ScopeCtx, start: number, end: number, scope: Scope): void => {
  let i = start;
  while (i < end) {
    if (startsQuery(ctx, i)) {
      const close = ctx.match[i] ?? end;
      analyzeQuery(ctx, i + 1, close, scope);
      i = close + 1;
    } else {
      i += 1;
    }
  }
};

// ---- 절 나누기 ----

export interface Clauses {
  head: Range;
  ranges: Map<string, Range>;
}

/**
 * IS [NOT] DISTINCT FROM, 집계 함수 뒤 WITHIN GROUP ( 같은 비절 키워드.
 * 이 모양이 아니면 절 키워드로 보고, 같은 절이 두 번 나오면 splitClauses가 해석을 거절한다.
 */
const isInlineKeyword = (ctx: Ctx, i: number): boolean => {
  const t = ctx.tokens;
  if (isWord(t[i], 'from')) {
    if (!isWord(t[i - 1], 'distinct')) return false;
    return isWord(t[i - 2], 'is') || (isWord(t[i - 2], 'not') && isWord(t[i - 3], 'is'));
  }
  if (isWord(t[i], 'group')) {
    return isWord(t[i - 1], 'within') && isPunct(t[i - 2], ')') && isPunct(t[i + 1], '(');
  }
  return false;
};

/** 깊이 0 절 키워드로 범위를 나눈다. 같은 절이 두 번 나오면 null */
export const splitClauses = (
  ctx: Ctx,
  start: number,
  end: number,
  keywords: string[],
): Clauses | null => {
  const found = new Map<string, number>();
  for (const i of topLevel(ctx, start, end)) {
    const tok = ctx.tokens[i];
    if (tok?.kind !== 'word' || tok.ident || !keywords.includes(tok.value)) continue;
    if (isInlineKeyword(ctx, i)) continue;
    if (found.has(tok.value)) return null;
    found.set(tok.value, i);
  }
  const sorted = [...found.values()].sort((a, b) => a - b);
  const ranges = new Map<string, Range>();
  for (const [kw, pos] of found) {
    ranges.set(kw, [pos + 1, sorted.find((p) => p > pos) ?? end]);
  }
  return { head: [start, sorted[0] ?? end], ranges };
};

// ---- SELECT 블록 ----

export const SELECT_CLAUSES = [
  'from', 'where', 'group', 'having', 'window', 'order', 'limit', 'offset', 'fetch', 'for', 'into',
];

const analyzeSelect = (ctx: ScopeCtx, start: number, end: number, scope: Scope): void => {
  ctx.handled.add(start);
  const clauses = splitClauses(ctx, start + 1, end, SELECT_CLAUSES);
  if (!clauses || clauses.ranges.has('into')) return fail(ctx, MSG.structure);
  scanGroups(ctx, clauses.head[0], clauses.head[1], scope);
  for (const [kw, [s, e]] of clauses.ranges) {
    if (kw !== 'from') scanGroups(ctx, s, e, scope);
  }
  const from = clauses.ranges.get('from');
  const sources = from ? parseFromList(ctx, from[0], from[1], scope) : [];
  if (!sources) return fail(ctx, MSG.structure);
  requireCoverage(ctx, sources, clauses.ranges.get('where') ?? null);
};

/** TABLE x: WHERE를 붙일 수 없으므로 면제·CTE가 아니면 거부 */
const analyzeTableTerm = (ctx: ScopeCtx, start: number, end: number, scope: Scope): void => {
  ctx.handled.add(start);
  const parsed = parseSource(ctx, start + 1, end, scope);
  if (!parsed || !parsed.source.isTable) return fail(ctx, MSG.structure);
  requireCoverage(ctx, [{ ...parsed.source, join: 'base', on: null }], null);
  scanGroups(ctx, parsed.end, end, scope);
};

const analyzeTerm = (ctx: ScopeCtx, start: number, end: number, scope: Scope): void => {
  const t = ctx.tokens[start];
  if (isWord(t, 'select')) return analyzeSelect(ctx, start, end, scope);
  if (isWord(t, 'values')) return scanGroups(ctx, start + 1, end, scope);
  if (isWord(t, 'table')) return analyzeTableTerm(ctx, start, end, scope);
  if (startsQuery(ctx, start)) {
    const close = ctx.match[start] ?? end;
    analyzeQuery(ctx, start + 1, close, scope);
    return scanGroups(ctx, close + 1, end, scope);
  }
  fail(ctx, MSG.structure);
};

const SET_OPS = ['union', 'intersect', 'except'];

const analyzeSetOps = (ctx: ScopeCtx, start: number, end: number, scope: Scope): void => {
  const terms = splitTop(ctx, start, end, (i) => isWord(ctx.tokens[i], ...SET_OPS));
  terms.forEach(([s, e], idx) => {
    const from = idx > 0 && isWord(ctx.tokens[s], 'all', 'distinct') ? s + 1 : s;
    analyzeTerm(ctx, from, e, scope);
  });
};

// ---- WITH ----

interface Cte {
  name: string;
  body: Range;
}

const parseCtes = (ctx: Ctx, start: number, end: number): { ctes: Cte[]; next: number } | null => {
  const t = ctx.tokens;
  const ctes: Cte[] = [];
  let i = start;
  for (;;) {
    const name = isStopWord(ctx, i) ? null : identName(t[i]);
    if (name === null) return null;
    i += 1;
    if (isPunct(t[i], '(')) i = afterGroup(ctx, i);
    if (!isWord(t[i], 'as')) return null;
    i += 1;
    if (isWord(t[i], 'not')) i += 1;
    if (isWord(t[i], 'materialized')) i += 1;
    if (!isPunct(t[i], '(')) return null;
    ctes.push({ name, body: [i + 1, ctx.match[i] ?? end] });
    i = afterGroup(ctx, i);
    if (!isPunct(t[i], ',')) break;
    i += 1;
  }
  return i < end ? { ctes, next: i } : null;
};

/** WITH 절의 CTE 본문을 분석하고 본문 시작 위치와 보이는 이름 목록을 돌려준다 */
const analyzeWith = (
  ctx: ScopeCtx,
  start: number,
  end: number,
  scope: Scope,
): { next: number; scope: Scope } | null => {
  const recursive = isWord(ctx.tokens[start], 'recursive');
  const parsed = parseCtes(ctx, recursive ? start + 1 : start, end);
  if (!parsed) return null;
  const all = new Set([...scope, ...parsed.ctes.map((c) => c.name)]);
  const seen = new Set(scope);
  for (const cte of parsed.ctes) {
    analyzeQuery(ctx, cte.body[0], cte.body[1], recursive ? all : new Set(seen));
    seen.add(cte.name);
  }
  return { next: parsed.next, scope: all };
};

/** 조회 쿼리(WITH·UNION·괄호 포함) 분석 */
export const analyzeQuery = (ctx: ScopeCtx, start: number, end: number, scope: Scope): void => {
  if (!isWord(ctx.tokens[start], 'with')) return analyzeSetOps(ctx, start, end, scope);
  const withResult = analyzeWith(ctx, start + 1, end, scope);
  if (!withResult) return fail(ctx, MSG.structure);
  analyzeSetOps(ctx, withResult.next, end, withResult.scope);
};

/** 분석하지 못한 SELECT·TABLE 키워드가 남았는지 */
export const hasUnhandledQuery = (ctx: ScopeCtx): boolean =>
  ctx.tokens.some((t, i) => isWord(t, 'select', 'table') && !ctx.handled.has(i));
