/**
 * 토큰 범위 유틸과 WHERE/ON 조건의 user_id 보장 분석.
 * 범위는 [start, end) 반열린 구간으로 다룬다.
 */

import type { Token } from './sql-lexer.js';

export interface Ctx {
  tokens: Token[];
  /** 여는/닫는 괄호 위치 → 짝 위치 (괄호가 아니면 -1) */
  match: number[];
  userId: number;
}

export type Range = [number, number];

/** 비한정 user_id 조건을 나타내는 한정자 */
export const UNQUALIFIED = '';

export const buildMatch = (tokens: Token[]): number[] => {
  const match = tokens.map(() => -1);
  const stack: number[] = [];
  tokens.forEach((t, i) => {
    if (t.kind !== 'punct') return;
    if (t.value === '(' || t.value === '[') stack.push(i);
    if (t.value === ')' || t.value === ']') {
      const open = stack.pop();
      if (open === undefined) return;
      match[open] = i;
      match[i] = open;
    }
  });
  return match;
};

/** 키워드 판정. `.` 뒤·AS 뒤처럼 이름 자리에 있는 word는 키워드로 보지 않는다 */
export const isWord = (t: Token | undefined, ...values: string[]): boolean =>
  t?.kind === 'word' && !t.ident && values.includes(t.value);

export const isPunct = (t: Token | undefined, value: string): boolean =>
  t?.kind === 'punct' && t.value === value;

/** word·qident의 이름. 다른 토큰이면 null */
export const identName = (t: Token | undefined): string | null =>
  t && (t.kind === 'word' || t.kind === 'qident') ? t.value : null;

/** 괄호 그룹의 끝 다음 위치 */
export const afterGroup = (ctx: Ctx, open: number): number => {
  const close = ctx.match[open] ?? -1;
  return close > open ? close + 1 : open + 1;
};

const skipCase = (ctx: Ctx, start: number, end: number): number => {
  let depth = 0;
  let i = start;
  while (i < end) {
    const t = ctx.tokens[i];
    if (isPunct(t, '(') || isPunct(t, '[')) {
      i = afterGroup(ctx, i);
      continue;
    }
    if (isWord(t, 'case')) depth += 1;
    if (isWord(t, 'end')) depth -= 1;
    i += 1;
    if (depth === 0) return i;
  }
  return end;
};

/** 괄호·CASE 바깥(깊이 0) 토큰 위치. 그룹은 여는 위치만 포함한다 */
export const topLevel = (ctx: Ctx, start: number, end: number): number[] => {
  const out: number[] = [];
  let i = start;
  while (i < end) {
    const t = ctx.tokens[i];
    out.push(i);
    if (isPunct(t, '(') || isPunct(t, '[')) i = afterGroup(ctx, i);
    else if (isWord(t, 'case')) i = skipCase(ctx, i, end);
    else i += 1;
  }
  return out;
};

/** 깊이 0 구분자로 범위 분할 */
export const splitTop = (
  ctx: Ctx,
  start: number,
  end: number,
  isSep: (i: number) => boolean,
): Range[] => {
  const parts: Range[] = [];
  let from = start;
  for (const i of topLevel(ctx, start, end)) {
    if (!isSep(i)) continue;
    parts.push([from, i]);
    from = i + 1;
  }
  parts.push([from, end]);
  return parts;
};

/** 범위 안 깊이 0에서 조건을 만족하는 첫 위치 (없으면 -1) */
export const findTop = (
  ctx: Ctx,
  start: number,
  end: number,
  pred: (i: number) => boolean,
): number => topLevel(ctx, start, end).find(pred) ?? -1;

// ---- user_id 보장 분석 ----

export interface Guarantee {
  /** 모든 행에서 user_id = N이 성립하는 한정자 (UNQUALIFIED 포함) */
  quals: Set<string>;
  /** a.user_id = b.user_id 형태의 등식 */
  links: Array<[string, string]>;
}

const emptyGuarantee = (): Guarantee => ({ quals: new Set(), links: [] });

/** [start, end)가 정확히 user_id 또는 q.user_id면 한정자 반환 */
const colRef = (ctx: Ctx, start: number, end: number): string | null => {
  const t = ctx.tokens;
  if (end - start === 1 && identName(t[start]) === 'user_id') return UNQUALIFIED;
  if (end - start !== 3 || !isPunct(t[start + 1], '.')) return null;
  const qual = identName(t[start]);
  return qual !== null && identName(t[start + 2]) === 'user_id' ? qual : null;
};

const conjunct = (ctx: Ctx, start: number, end: number, g: Guarantee): void => {
  const t = ctx.tokens;
  if (isPunct(t[start], '(') && ctx.match[start] === end - 1) {
    const inner = conditionGuarantee(ctx, start + 1, end - 1);
    inner.quals.forEach((q) => g.quals.add(q));
    g.links.push(...inner.links);
    return;
  }
  const eqs = topLevel(ctx, start, end).filter((i) => t[i]?.kind === 'op' && t[i]?.value === '=');
  const eq = eqs[0];
  if (eqs.length !== 1 || eq === undefined) return;
  const left = colRef(ctx, start, eq);
  if (left === null) return;
  const rhs = t[eq + 1];
  if (end - eq === 2 && rhs?.kind === 'number' && rhs.value === String(ctx.userId)) {
    g.quals.add(left);
    return;
  }
  const right = colRef(ctx, eq + 1, end);
  if (right !== null && left !== UNQUALIFIED && right !== UNQUALIFIED) g.links.push([left, right]);
};

/** AND로만 묶인 범위의 보장 (BETWEEN a AND b의 AND는 나누지 않는다) */
const andGuarantee = (ctx: Ctx, start: number, end: number): Guarantee => {
  const g = emptyGuarantee();
  let pendingBetween = 0;
  const parts = splitTop(ctx, start, end, (i) => {
    const tok = ctx.tokens[i];
    if (isWord(tok, 'between')) pendingBetween += 1;
    if (!isWord(tok, 'and')) return false;
    if (pendingBetween > 0) {
      pendingBetween -= 1;
      return false;
    }
    return true;
  });
  for (const [s, e] of parts) conjunct(ctx, s, e, g);
  return g;
};

/** 등식 연결을 따라 보장 한정자를 넓힌다 */
export const closeOver = (g: Guarantee): Set<string> => {
  const quals = new Set(g.quals);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [a, b] of g.links) {
      if (quals.has(a) && !quals.has(b)) quals.add(b);
      else if (quals.has(b) && !quals.has(a)) quals.add(a);
      else continue;
      grew = true;
    }
  }
  return quals;
};

/** 조건 범위가 모든 행에 보장하는 user_id 한정자. OR는 모든 가지가 보장해야 인정한다 */
export const conditionGuarantee = (ctx: Ctx, start: number, end: number): Guarantee => {
  const branches = splitTop(ctx, start, end, (i) => isWord(ctx.tokens[i], 'or'));
  if (branches.length === 1) return andGuarantee(ctx, start, end);
  const sets = branches.map(([s, e]) => closeOver(andGuarantee(ctx, s, e)));
  const [first, ...rest] = sets;
  const quals = new Set([...(first ?? [])].filter((q) => rest.every((s) => s.has(q))));
  return { quals, links: [] };
};
