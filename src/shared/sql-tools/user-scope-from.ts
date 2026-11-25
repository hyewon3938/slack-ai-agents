/**
 * FROM 목록 해석: 서브쿼리·함수·테이블 항목과 JOIN 조건을 소스 목록으로 읽는다.
 * 해석하지 못한 구조는 null을 돌려 호출부가 거절하게 한다.
 */

import {
  type Ctx,
  type Range,
  afterGroup,
  findTop,
  identName,
  isPunct,
  isWord,
} from './sql-blocks.js';
import { analyzeQuery, scanGroups } from './user-scope.js';
import {
  BLOCKED_TABLES,
  MSG,
  type Scope,
  type ScopeCtx,
  SHARED_READONLY_TABLES,
  USER_ID_EXEMPT_TABLES,
  fail,
  startsQuery,
} from './user-scope-rules.js';

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

export const isStopWord = (ctx: Ctx, i: number): boolean => {
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
  if (SHARED_READONLY_TABLES.has(name)) return 'exempt';
  return USER_ID_EXEMPT_TABLES.has(name) ? 'exempt' : 'required';
};

/**
 * FROM 항목 하나: 서브쿼리, 함수, 테이블.
 * LATERAL은 서브쿼리·함수 앞에만 올 수 있으므로 테이블 앞에 오면 해석을 거절한다.
 * 변경문 대상(UPDATE·DELETE)과 FROM·USING 목록도 이 함수로 읽으므로 같은 규칙이 적용된다.
 */
export const parseSource = (
  ctx: ScopeCtx,
  start: number,
  end: number,
  scope: Scope,
): Parsed | null => {
  const t = ctx.tokens;
  const lateral = isWord(t[start], 'lateral');
  let i = lateral ? start + 1 : start;
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
  if (lateral) return null;
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
