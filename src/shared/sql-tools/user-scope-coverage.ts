/**
 * 범위 보장 확인: 소스 목록과 WHERE·JOIN 조건으로 필수 테이블마다 user_id = N이 걸리는지 본다.
 */

import {
  type Ctx,
  type Guarantee,
  type Range,
  UNQUALIFIED,
  conditionGuarantee,
  identName,
  isPunct,
} from './sql-blocks.js';
import type { Source } from './user-scope-from.js';
import { MSG, type ScopeCtx, fail, startsQuery } from './user-scope-rules.js';

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

/** 범위 안(하위 서브쿼리 제외)에 별칭 없이 쓴 user_id가 있는지 */
const hasBareUserId = (ctx: Ctx, [start, end]: Range): boolean => {
  const t = ctx.tokens;
  let i = start;
  while (i < end) {
    if (startsQuery(ctx, i)) {
      i = (ctx.match[i] ?? end) + 1;
      continue;
    }
    const bare = !isPunct(t[i - 1], '.') && !isPunct(t[i + 1], '.');
    if (identName(t[i]) === 'user_id' && bare) return true;
    i += 1;
  }
  return false;
};

/**
 * 블록의 소스가 모두 user_id 컬럼이 없는 테이블이면 비한정 user_id는 해석이 애매하므로 거절하고,
 * 그 밖에는 필수 테이블마다 user_id = N 보장을 확인한다.
 */
export const requireCoverage = (ctx: ScopeCtx, sources: Source[], where: Range | null): void => {
  const noUserColumn = sources.length > 0 && sources.every((s) => s.isTable && !s.required);
  const conds = [where, ...sources.map((s) => s.on)].filter((r): r is Range => r !== null);
  if (noUserColumn && conds.some((r) => hasBareUserId(ctx, r))) fail(ctx, MSG.noUserColumn);
  const missing = uncoveredSources(ctx, sources, where);
  if (missing.length > 0) fail(ctx, MSG.missing(ctx.userId, missing));
};
