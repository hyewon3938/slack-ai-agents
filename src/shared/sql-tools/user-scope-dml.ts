/**
 * 변경 쿼리(INSERT·UPDATE·DELETE)의 user_id 범위 분석.
 * UPDATE·DELETE는 대상과 FROM/USING 테이블마다 user_id = N 보장을,
 * INSERT는 user_id 컬럼 값이 N인지와 ON CONFLICT DO UPDATE의 충돌 대상을 확인한다.
 */

import {
  type Range,
  findTop,
  identName,
  isPunct,
  isWord,
  splitTop,
  topLevel,
} from './sql-blocks.js';
import { otherUserMessage } from './sql-guards.js';
import { type ModifyOp, getTableAccess, isToolModifyAllowed } from './table-permissions.js';
import {
  BLOCKED_TABLES,
  MSG,
  type ScopeCtx,
  SELECT_CLAUSES,
  SHARED_READONLY_TABLES,
  type Source,
  USER_ID_EXEMPT_TABLES,
  analyzeQuery,
  fail,
  parseFromList,
  parseSource,
  requireCoverage,
  scanGroups,
  splitClauses,
} from './user-scope.js';

const EMPTY_SCOPE: ReadonlySet<string> = new Set();

/** user_id 컬럼이 없어 ON CONFLICT 대상에 user_id를 둘 수 없는 테이블 */
const CONFLICT_EXEMPT_TABLES = USER_ID_EXEMPT_TABLES;

const DML_MSG = {
  setUserId: '보안 규칙: user_id 값은 바꿀 수 없어.',
  insertUserId: '보안 규칙: INSERT에 user_id 컬럼을 포함해줘.',
  conflict: '보안 규칙: ON CONFLICT DO UPDATE는 충돌 대상에 user_id를 포함해야 해.',
  schema: '보안 규칙: 변경 대상은 public 스키마 테이블만 쓸 수 있어.',
  readOnly: (name: string): string => `보안 규칙: ${name} 테이블은 조회만 할 수 있어.`,
  opDenied: (name: string, op: ModifyOp): string =>
    `보안 규칙: ${name} 테이블은 ${op.toUpperCase()}할 수 없어.`,
  columnsOnly: (name: string, columns: readonly string[]): string =>
    `보안 규칙: ${name} 테이블은 ${columns.join(', ')} 컬럼만 바꿀 수 있어.`,
};

const isComma = (ctx: ScopeCtx) => (i: number): boolean => isPunct(ctx.tokens[i], ',');

const isEq = (ctx: ScopeCtx) => (i: number): boolean =>
  ctx.tokens[i]?.kind === 'op' && ctx.tokens[i]?.value === '=';

/** SET 목록 항목마다 `=` 왼쪽에 나온 식별자 (권한 확인용. 구조 오류는 checkSetList가 잡는다) */
const listSetColumns = (ctx: ScopeCtx, start: number, end: number): string[] =>
  splitTop(ctx, start, end, isComma(ctx)).flatMap(([s, e]) => {
    const eq = findTop(ctx, s, e, isEq(ctx));
    if (eq < 0) return [];
    return ctx.tokens.slice(s, eq).map(identName).filter((n): n is string => n !== null);
  });

/** SET 목록: user_id는 바꿀 수 없고, 값 쪽 서브쿼리도 분석한다 */
const checkSetList = (ctx: ScopeCtx, start: number, end: number): void => {
  const t = ctx.tokens;
  for (const [s, e] of splitTop(ctx, start, end, isComma(ctx))) {
    const eq = findTop(ctx, s, e, isEq(ctx));
    if (eq < 0) {
      fail(ctx, MSG.structure);
      continue;
    }
    if (t.slice(s, eq).some((tok) => identName(tok) === 'user_id')) fail(ctx, DML_MSG.setUserId);
    scanGroups(ctx, eq + 1, e, EMPTY_SCOPE);
  }
};

/** 변경 작업: UPDATE는 SET 대상 컬럼까지 본다 */
type WriteOp = { op: 'insert' | 'delete' } | { op: 'update'; columns: readonly string[] };

/**
 * 변경 대상 테이블: public 밖 스키마는 거절하고, 테이블별 권한은 도구 역할의 권한 목록(table-permissions.ts)을 따른다.
 * 계정·마이그레이션 테이블은 parseSource·analyzeInsert가 이미 거절 문구를 남긴다.
 */
const isWritableTarget = (
  ctx: ScopeCtx,
  schema: string | null,
  name: string,
  write: WriteOp,
): boolean => {
  if (schema !== null && schema !== 'public') {
    fail(ctx, DML_MSG.schema);
    return false;
  }
  const columns = write.op === 'update' ? write.columns : [];
  if (isToolModifyAllowed(name, write.op, columns)) return true;
  if (BLOCKED_TABLES.has(name)) return false;
  const entry = getTableAccess(name);
  if (SHARED_READONLY_TABLES.has(name) || entry.access === 'read') fail(ctx, DML_MSG.readOnly(name));
  else if (entry.access === 'none') fail(ctx, MSG.blockedTable(name));
  else if (write.op === 'update' && Array.isArray(entry.update)) {
    fail(ctx, DML_MSG.columnsOnly(name, entry.update));
  } else fail(ctx, DML_MSG.opDenied(name, write.op));
  return false;
};

/** UPDATE·DELETE 대상: 실제 테이블 하나. 앞에 LATERAL이 오면 parseSource가 해석을 거절한다 */
const parseTarget = (ctx: ScopeCtx, [start, end]: Range, write: WriteOp): Source | null => {
  const parsed = parseSource(ctx, start, end, EMPTY_SCOPE);
  if (!parsed || !parsed.source.isTable || parsed.end !== end) return null;
  const t = ctx.tokens;
  const first = isWord(t[start], 'only') ? start + 1 : start;
  const schema = isPunct(t[first + 1], '.') ? identName(t[first]) : null;
  if (!isWritableTarget(ctx, schema, parsed.source.label, write)) return null;
  return { ...parsed.source, join: 'base', on: null };
};

const checkWhere = (ctx: ScopeCtx, where: Range | undefined): void => {
  if (!where) return;
  if (isWord(ctx.tokens[where[0]], 'current') && isWord(ctx.tokens[where[0] + 1], 'of')) {
    fail(ctx, MSG.structure);
    return;
  }
  scanGroups(ctx, where[0], where[1], EMPTY_SCOPE);
};

const finishWriteScope = (
  ctx: ScopeCtx,
  target: Source,
  extra: Range | undefined,
  ranges: Map<string, Range>,
): void => {
  const sources = extra ? parseFromList(ctx, extra[0], extra[1], EMPTY_SCOPE) : [];
  if (!sources) return fail(ctx, MSG.structure);
  const where = ranges.get('where');
  checkWhere(ctx, where);
  requireCoverage(ctx, [target, ...sources], where ?? null);
  const returning = ranges.get('returning');
  if (returning) scanGroups(ctx, returning[0], returning[1], EMPTY_SCOPE);
};

/** UPDATE target [alias] SET ... [FROM ...] WHERE ... [RETURNING ...] */
export const analyzeUpdate = (ctx: ScopeCtx, end: number): void => {
  const clauses = splitClauses(ctx, 1, end, ['set', 'from', 'where', 'returning']);
  const set = clauses?.ranges.get('set');
  const columns = set ? listSetColumns(ctx, set[0], set[1]) : [];
  const target = clauses ? parseTarget(ctx, clauses.head, { op: 'update', columns }) : null;
  if (!clauses || !set || !target) return fail(ctx, MSG.structure);
  checkSetList(ctx, set[0], set[1]);
  finishWriteScope(ctx, target, clauses.ranges.get('from'), clauses.ranges);
};

/** DELETE FROM target [alias] [USING ...] WHERE ... [RETURNING ...] */
export const analyzeDelete = (ctx: ScopeCtx, end: number): void => {
  if (!isWord(ctx.tokens[1], 'from')) return fail(ctx, MSG.structure);
  const clauses = splitClauses(ctx, 2, end, ['using', 'where', 'returning']);
  const target = clauses ? parseTarget(ctx, clauses.head, { op: 'delete' }) : null;
  if (!clauses || !target) return fail(ctx, MSG.structure);
  finishWriteScope(ctx, target, clauses.ranges.get('using'), clauses.ranges);
};

// ---- INSERT ----

interface InsertTarget {
  schema: string | null;
  name: string;
  columns: string[] | null;
  next: number;
}

const parseInsertTarget = (ctx: ScopeCtx, end: number): InsertTarget | null => {
  const t = ctx.tokens;
  if (!isWord(t[1], 'into') || isWord(t[2], 'lateral')) return null;
  const qualified = isPunct(t[3], '.');
  const schema = qualified ? identName(t[2]) : null;
  let i = qualified ? 4 : 2;
  const name = identName(t[i]);
  if (name === null || (qualified && schema === null)) return null;
  i += 1;
  if (isWord(t[i], 'as')) {
    if (identName(t[i + 1]) === null) return null;
    i += 2;
  }
  if (!isPunct(t[i], '(')) return { schema, name, columns: null, next: i };
  const close = ctx.match[i] ?? end;
  const columns = splitTop(ctx, i + 1, close, isComma(ctx)).map(([s, e]) =>
    e - s === 1 ? identName(t[s]) : null,
  );
  if (columns.some((c) => c === null)) return null;
  return { schema, name, columns: columns.map((c) => c ?? ''), next: close + 1 };
};

const isUserIdLiteral = (ctx: ScopeCtx, start: number): boolean => {
  const t = ctx.tokens[start];
  return t?.kind === 'number' && t.value === String(ctx.userId);
};

/** 항목 전체를 감싼 괄호를 벗긴 범위 */
const unwrapItem = (ctx: ScopeCtx, [s, e]: Range): Range => {
  let range: Range = [s, e];
  while (isPunct(ctx.tokens[range[0]], '(') && ctx.match[range[0]] === range[1] - 1) {
    range = [range[0] + 1, range[1] - 1];
  }
  return range;
};

/**
 * `*`, `x.*`, `(expr).*`처럼 한 항목이 여러 열로 펼쳐지는지.
 * 펼쳐지면 뒤 항목의 자리가 밀려 user_id 자리를 셀 수 없다.
 */
const isStarItem = (ctx: ScopeCtx, item: Range): boolean => {
  const t = ctx.tokens;
  const [s, e] = unwrapItem(ctx, item);
  if (isWord(t[s], 'select', 'values', 'with', 'table')) return false;
  return topLevel(ctx, s, e).some(
    (i) => t[i]?.kind === 'op' && t[i]?.value === '*' && (i === s || isPunct(t[i - 1], '.')),
  );
};

/** SELECT 목록 첫 항목 앞의 ALL·DISTINCT [ON (...)]를 건너뛴 위치 */
const afterSelectQuantifier = (ctx: ScopeCtx, start: number): number => {
  const t = ctx.tokens;
  if (isWord(t[start], 'all')) return start + 1;
  if (!isWord(t[start], 'distinct')) return start;
  if (!isWord(t[start + 1], 'on') || !isPunct(t[start + 2], '(')) return start + 1;
  return (ctx.match[start + 2] ?? start + 2) + 1;
};

/** VALUES (...), (...): 튜플마다 user_id 자리 값이 정확히 N */
const checkValues = (ctx: ScopeCtx, start: number, end: number, userIdx: number): void => {
  for (const [s, e] of splitTop(ctx, start + 1, end, isComma(ctx))) {
    if (!isPunct(ctx.tokens[s], '(') || ctx.match[s] !== e - 1) return fail(ctx, MSG.structure);
    const items = splitTop(ctx, s + 1, e - 1, isComma(ctx));
    if (userIdx >= 0 && items.some((r) => isStarItem(ctx, r))) return fail(ctx, MSG.structure);
    const item = items[userIdx];
    if (userIdx >= 0 && !(item && item[1] - item[0] === 1 && isUserIdLiteral(ctx, item[0]))) {
      fail(ctx, otherUserMessage(ctx.userId));
    }
    scanGroups(ctx, s + 1, e - 1, EMPTY_SCOPE);
  }
};

/** N, N alias, N AS alias */
const isSelectedUserId = (ctx: ScopeCtx, [s, e]: Range): boolean => {
  if (!isUserIdLiteral(ctx, s)) return false;
  if (e - s === 1) return true;
  if (e - s === 2) return identName(ctx.tokens[s + 1]) !== null;
  return e - s === 3 && isWord(ctx.tokens[s + 1], 'as') && identName(ctx.tokens[s + 2]) !== null;
};

/** INSERT ... SELECT: 단순 SELECT의 user_id 자리 값이 정확히 N */
const checkSelectedValue = (ctx: ScopeCtx, start: number, end: number, userIdx: number): void => {
  const t = ctx.tokens;
  const setOp = findTop(ctx, start, end, (i) => isWord(t[i], 'union', 'intersect', 'except'));
  const clauses = splitClauses(ctx, start + 1, end, SELECT_CLAUSES);
  if (!isWord(t[start], 'select') || setOp >= 0 || !clauses) return fail(ctx, MSG.structure);
  const [headStart, headEnd] = clauses.head;
  const listed = splitTop(ctx, afterSelectQuantifier(ctx, headStart), headEnd, isComma(ctx));
  if (listed.some((r) => isStarItem(ctx, r))) return fail(ctx, MSG.structure);
  const item = splitTop(ctx, headStart, headEnd, isComma(ctx))[userIdx];
  if (!item || !isSelectedUserId(ctx, item)) fail(ctx, otherUserMessage(ctx.userId));
};

const checkInsertBody = (ctx: ScopeCtx, start: number, end: number, userIdx: number): void => {
  const t = ctx.tokens;
  if (isWord(t[start], 'default')) {
    const ok = isWord(t[start + 1], 'values') && end === start + 2 && userIdx < 0;
    if (!ok) fail(ctx, MSG.structure);
    return;
  }
  if (isWord(t[start], 'values')) return checkValues(ctx, start, end, userIdx);
  if (userIdx >= 0) checkSelectedValue(ctx, start, end, userIdx);
  analyzeQuery(ctx, start, end, EMPTY_SCOPE);
};

/** ON CONFLICT [(cols)] [WHERE ...] DO NOTHING | DO UPDATE SET ... [WHERE ...] */
const checkConflict = (ctx: ScopeCtx, start: number, end: number, table: string): void => {
  const t = ctx.tokens;
  let i = start + 2;
  if (isWord(t[i], 'on')) return fail(ctx, MSG.structure);
  const cols: Range | null = isPunct(t[i], '(') ? [i + 1, ctx.match[i] ?? end] : null;
  if (cols) i = cols[1] + 1;
  const doIdx = findTop(ctx, i, end, (j) => isWord(t[j], 'do'));
  if (doIdx < 0 || (i < doIdx && !isWord(t[i], 'where'))) return fail(ctx, MSG.structure);
  if (i < doIdx) scanGroups(ctx, i + 1, doIdx, EMPTY_SCOPE);
  if (isWord(t[doIdx + 1], 'nothing') && doIdx + 2 === end) return;
  if (!isWord(t[doIdx + 1], 'update') || !isWord(t[doIdx + 2], 'set')) {
    return fail(ctx, MSG.structure);
  }
  const hasUserId = cols !== null && t.slice(cols[0], cols[1]).some((x) => identName(x) === 'user_id');
  if (!hasUserId && !CONFLICT_EXEMPT_TABLES.has(table)) fail(ctx, DML_MSG.conflict);
  const whereIdx = findTop(ctx, doIdx + 3, end, (j) => isWord(t[j], 'where'));
  const setEnd = whereIdx < 0 ? end : whereIdx;
  const columns = listSetColumns(ctx, doIdx + 3, setEnd);
  isWritableTarget(ctx, null, table, { op: 'update', columns });
  checkSetList(ctx, doIdx + 3, setEnd);
  if (whereIdx >= 0) scanGroups(ctx, whereIdx + 1, end, EMPTY_SCOPE);
};

/** INSERT INTO target [AS alias] [(cols)] body [ON CONFLICT ...] [RETURNING ...] */
export const analyzeInsert = (ctx: ScopeCtx, end: number): void => {
  const t = ctx.tokens;
  const target = parseInsertTarget(ctx, end);
  if (!target) return fail(ctx, MSG.structure);
  if (BLOCKED_TABLES.has(target.name)) return fail(ctx, MSG.blockedTable(target.name));
  if (!isWritableTarget(ctx, target.schema, target.name, { op: 'insert' })) return;
  const userIdx = target.columns?.indexOf('user_id') ?? -1;
  if (userIdx < 0 && !USER_ID_EXEMPT_TABLES.has(target.name)) {
    return fail(ctx, DML_MSG.insertUserId);
  }
  const isConflict = (i: number): boolean => isWord(t[i], 'on') && isWord(t[i + 1], 'conflict');
  const tail = findTop(ctx, target.next, end, (i) => isConflict(i) || isWord(t[i], 'returning'));
  const bodyEnd = tail < 0 ? end : tail;
  checkInsertBody(ctx, target.next, bodyEnd, userIdx);
  const returning = findTop(ctx, bodyEnd, end, (i) => isWord(t[i], 'returning'));
  if (isConflict(bodyEnd)) checkConflict(ctx, bodyEnd, returning < 0 ? end : returning, target.name);
  if (returning >= 0) scanGroups(ctx, returning + 1, end, EMPTY_SCOPE);
};
