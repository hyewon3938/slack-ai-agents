/**
 * 조회 쿼리의 user_id 범위 분석.
 * FROM으로 읽는 테이블마다, 그 테이블이 속한 SELECT 블록의 WHERE·JOIN 조건이
 * user_id = N을 보장하는지 확인한다. 해석하지 못한 구조는 통과시키지 않는다.
 */

import {
  type Ctx,
  type Guarantee,
  type Range,
  UNQUALIFIED,
  afterGroup,
  conditionGuarantee,
  findTop,
  identName,
  isPunct,
  isWord,
  splitTop,
  topLevel,
} from './sql-blocks.js';

export interface ScopeCtx extends Ctx {
  issues: string[];
  /** 분석을 마친 SELECT·TABLE 키워드 위치 */
  handled: Set<number>;
}

type Scope = ReadonlySet<string>;

/** user_id 컬럼이 없거나 공용으로 쓰는 테이블 (user_id 조건 면제) */
export const USER_ID_EXEMPT_TABLES = new Set([
  'sleep_events',
  'notification_settings',
  'categories',
  'reminders',
]);

/** 계정 정보 테이블: user_id 컬럼이 없어 범위를 보장할 수 없으므로 읽지 않는다 */
export const BLOCKED_TABLES = new Set(['users']);

export const MSG = {
  structure:
    '보안 규칙: 쿼리 구조를 확인할 수 없어. 단순한 SELECT/INSERT/UPDATE/DELETE 형태로 다시 써줘.',
  blockedTable: (name: string): string => `보안 규칙: ${name} 테이블은 쓸 수 없어.`,
  missing: (userId: number, labels: string[]): string =>
    `보안 규칙: 이 쿼리에는 user_id = ${userId} 조건이 필요해. ` +
    `JOIN·서브쿼리·UNION으로 읽는 테이블마다 WHERE에 별칭.user_id = ${userId} 조건을 AND로 넣어줘. ` +
    `(조건이 없는 테이블: ${labels.join(', ')})`,
};

export const fail = (ctx: ScopeCtx, message: string): void => {
  ctx.issues.push(message);
};

const QUERY_STARTS = ['select', 'with', 'values', 'table'];

export const startsQuery = (ctx: Ctx, open: number): boolean =>
  isPunct(ctx.tokens[open], '(') && isWord(ctx.tokens[open + 1], ...QUERY_STARTS);

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

/** IS DISTINCT FROM, WITHIN GROUP 같은 비절 키워드 */
const isInlineKeyword = (ctx: Ctx, i: number): boolean => {
  const t = ctx.tokens;
  if (isWord(t[i], 'from')) return isWord(t[i - 1], 'distinct') && isWord(t[i - 2], 'is', 'not');
  if (isWord(t[i], 'group')) return isWord(t[i - 1], 'within');
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
    if (tok?.kind !== 'word' || !keywords.includes(tok.value) || isInlineKeyword(ctx, i)) continue;
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

// ---- FROM 목록 ----

export type JoinKind = 'base' | 'inner' | 'left' | 'other';

export interface Source {
  /** 조건에서 이 소스를 가리키는 한정자 (별칭, 없으면 테이블명) */
  qual: string | null;
  /** user_id 조건이 필요한 실제 테이블인지 */
  required: boolean;
  isTable: boolean;
  label: string;
  join: JoinKind;
  on: Range | null;
}

const ALIAS_STOP = new Set([
  'on', 'using', 'where', 'group', 'having', 'window', 'order', 'limit', 'offset', 'fetch',
  'for', 'union', 'intersect', 'except', 'join', 'inner', 'left', 'right', 'full', 'cross',
  'natural', 'set', 'returning', 'tablesample', 'values', 'select', 'from', 'into', 'default',
  'lateral', 'and', 'or', 'with', 'only', 'as',
]);

const isStopWord = (ctx: Ctx, i: number): boolean => {
  const t = ctx.tokens[i];
  return t?.kind === 'word' && ALIAS_STOP.has(t.value);
};

interface Alias {
  alias: string | null;
  end: number;
  columns: boolean;
}

const parseAlias = (ctx: Ctx, start: number, end: number): Alias | null => {
  let i = start;
  const hasAs = isWord(ctx.tokens[i], 'as');
  if (hasAs) i += 1;
  const name = i < end && !isStopWord(ctx, i) ? identName(ctx.tokens[i]) : null;
  if (name === null) return hasAs ? null : { alias: null, end: start, columns: false };
  i += 1;
  const columns = i < end && isPunct(ctx.tokens[i], '(');
  return { alias: name, end: columns ? afterGroup(ctx, i) : i, columns };
};

type Parsed = { end: number; source: Omit<Source, 'join' | 'on'> };

const subquerySource = (ctx: ScopeCtx, open: number, end: number, scope: Scope): Parsed | null => {
  if (!startsQuery(ctx, open)) return null;
  const close = ctx.match[open] ?? end;
  analyzeQuery(ctx, open + 1, close, scope);
  const alias = parseAlias(ctx, close + 1, end);
  if (!alias) return null;
  const source = { qual: alias.alias, required: false, isTable: false, label: 'subquery' };
  return { end: alias.end, source };
};

const tableKind = (parts: string[], scope: Scope): 'cte' | 'exempt' | 'required' => {
  const name = parts[parts.length - 1] ?? '';
  if (parts.length === 1 && scope.has(name)) return 'cte';
  if (parts.length === 2 && parts[0] === 'information_schema') return 'exempt';
  return USER_ID_EXEMPT_TABLES.has(name) ? 'exempt' : 'required';
};

/** FROM 항목 하나: 서브쿼리, 함수, 테이블 */
export const parseSource = (
  ctx: ScopeCtx,
  start: number,
  end: number,
  scope: Scope,
): Parsed | null => {
  const t = ctx.tokens;
  let i = isWord(t[start], 'lateral') ? start + 1 : start;
  if (isPunct(t[i], '(')) return subquerySource(ctx, i, end, scope);
  if (isWord(t[i], 'only')) i += 1;
  const parts: string[] = [];
  while (i < end && !isStopWord(ctx, i) && identName(t[i]) !== null) {
    parts.push(identName(t[i]) ?? '');
    i += 1;
    if (!isPunct(t[i], '.')) break;
    i += 1;
  }
  const name = parts[parts.length - 1];
  if (name === undefined || parts.length > 2 || isPunct(t[i - 1], '.')) return null;
  if (isPunct(t[i], '(')) {
    scanGroups(ctx, i + 1, ctx.match[i] ?? end, scope);
    i = afterGroup(ctx, i);
    if (isWord(t[i], 'with') && isWord(t[i + 1], 'ordinality')) i += 2;
    const alias = parseAlias(ctx, i, end);
    if (!alias) return null;
    const source = { qual: alias.alias ?? name, required: false, isTable: false, label: name };
    return { end: alias.end, source };
  }
  if (BLOCKED_TABLES.has(name)) fail(ctx, MSG.blockedTable(name));
  const kind = tableKind(parts, scope);
  const alias = parseAlias(ctx, i, end);
  if (!alias || (alias.columns && kind !== 'cte') || t[i]?.kind === 'op') return null;
  const source = {
    qual: alias.alias ?? name,
    required: kind === 'required',
    isTable: kind !== 'cte',
    label: name,
  };
  return { end: alias.end, source };
};

interface JoinWord {
  kind: JoinKind;
  needsCond: boolean;
  next: number;
}

const parseJoinWord = (ctx: Ctx, start: number): JoinWord | null => {
  const t = ctx.tokens;
  let i = start;
  const natural = isWord(t[i], 'natural');
  if (natural) i += 1;
  let kind: JoinKind = 'inner';
  let cross = false;
  if (isWord(t[i], 'inner')) i += 1;
  else if (isWord(t[i], 'left')) [kind, i] = ['left', i + 1];
  else if (isWord(t[i], 'right', 'full')) [kind, i] = ['other', i + 1];
  else if (isWord(t[i], 'cross')) [kind, cross, i] = ['other', true, i + 1];
  if (isWord(t[i], 'outer')) i += 1;
  if (!isWord(t[i], 'join')) return null;
  const needsCond = !natural && !cross;
  return { kind: natural ? 'other' : kind, needsCond, next: i + 1 };
};

const isJoinBoundary = (ctx: Ctx, i: number): boolean => {
  const t = ctx.tokens;
  if (isPunct(t[i], ',')) return true;
  if (isWord(t[i], 'join', 'inner', 'cross', 'natural', 'full', 'on', 'using')) return true;
  return isWord(t[i], 'left', 'right') && !isPunct(t[i + 1], '(');
};

/** ON/USING 조건. 반환값은 [조건 범위 또는 null, 다음 위치] */
const parseJoinCond = (
  ctx: ScopeCtx,
  start: number,
  end: number,
  scope: Scope,
): [Range | null, number] | null => {
  const t = ctx.tokens;
  if (isWord(t[start], 'using') && isPunct(t[start + 1], '(')) {
    return [null, afterGroup(ctx, start + 1)];
  }
  if (!isWord(t[start], 'on')) return null;
  const found = findTop(ctx, start + 1, end, (i) => isJoinBoundary(ctx, i));
  const condEnd = found < 0 ? end : found;
  scanGroups(ctx, start + 1, condEnd, scope);
  return [[start + 1, condEnd], condEnd];
};

/** FROM 목록 전체. 해석하지 못하면 null */
export const parseFromList = (
  ctx: ScopeCtx,
  start: number,
  end: number,
  scope: Scope,
): Source[] | null => {
  const sources: Source[] = [];
  let i = start;
  let pending: JoinWord = { kind: 'base', needsCond: false, next: start };
  for (;;) {
    const parsed = parseSource(ctx, i, end, scope);
    if (!parsed) return null;
    i = parsed.end;
    let on: Range | null = null;
    if (pending.needsCond) {
      const cond = parseJoinCond(ctx, i, end, scope);
      if (!cond) return null;
      [on, i] = cond;
    }
    sources.push({ ...parsed.source, join: pending.kind, on });
    if (i >= end) return sources;
    if (isPunct(ctx.tokens[i], ',')) {
      pending = { kind: 'base', needsCond: false, next: i + 1 };
    } else {
      const word = parseJoinWord(ctx, i);
      if (!word) return null;
      pending = word;
    }
    i = pending.next;
  }
};

// ---- 범위 보장 ----

const closeDirected = (seed: Set<string>, edges: Array<[string, string]>): Set<string> => {
  const covered = new Set(seed);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [from, to] of edges) {
      if (!covered.has(from) || covered.has(to)) continue;
      covered.add(to);
      grew = true;
    }
  }
  return covered;
};

/**
 * user_id = N이 보장되지 않는 필수 테이블 이름 목록.
 * WHERE·INNER JOIN 조건은 모든 소스에, LEFT JOIN 조건은 그 JOIN으로 붙은 소스에만 적용한다.
 * 비한정 user_id는 소스가 하나일 때만 인정한다.
 */
export const uncoveredSources = (ctx: Ctx, sources: Source[], where: Range | null): string[] => {
  const seed = new Set<string>();
  const edges: Array<[string, string]> = [];
  const single = sources.length === 1 ? (sources[0]?.qual ?? null) : null;
  const addAll = (g: Guarantee): void => {
    g.quals.forEach((q) => {
      const resolved = q === UNQUALIFIED ? single : q;
      if (resolved !== null) seed.add(resolved);
    });
    g.links.forEach(([a, b]) => edges.push([a, b], [b, a]));
  };
  if (where) addAll(conditionGuarantee(ctx, where[0], where[1]));
  for (const s of sources) {
    if (!s.on || s.qual === null) continue;
    const g = conditionGuarantee(ctx, s.on[0], s.on[1]);
    if (s.join === 'inner') addAll(g);
    if (s.join !== 'left') continue;
    const self = s.qual;
    if (g.quals.has(self)) seed.add(self);
    g.links.forEach(([a, b]) => {
      if (b === self) edges.push([a, b]);
      if (a === self) edges.push([b, a]);
    });
  }
  const covered = closeDirected(seed, edges);
  return sources
    .filter((s) => s.required && (s.qual === null || !covered.has(s.qual)))
    .map((s) => s.label);
};

export const requireCoverage = (ctx: ScopeCtx, sources: Source[], where: Range | null): void => {
  const missing = uncoveredSources(ctx, sources, where);
  if (missing.length > 0) fail(ctx, MSG.missing(ctx.userId, missing));
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
