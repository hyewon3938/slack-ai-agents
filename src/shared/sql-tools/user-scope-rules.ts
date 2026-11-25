/**
 * user_id 범위 분석의 공용 규칙: 분석 상태, 테이블 목록, 거절 문구.
 * 조회 분석(user-scope.ts)과 변경 분석(user-scope-dml.ts)이 함께 쓴다.
 */

import { type Ctx, isPunct, isWord } from './sql-blocks.js';

export interface ScopeCtx extends Ctx {
  issues: string[];
  /** 분석을 마친 SELECT·TABLE 키워드 위치 */
  handled: Set<number>;
}

/** 블록에서 보이는 CTE 이름 */
export type Scope = ReadonlySet<string>;

/** user_id 컬럼이 없는 테이블 (user_id 조건 면제) */
export const USER_ID_EXEMPT_TABLES = new Set(['notification_settings', 'reminders']);

/** 사주 기준표: 모든 사용자가 같이 읽는 공용 데이터. 조건 없이 읽고, 변경 대상으로는 쓰지 않는다 */
export const SHARED_READONLY_TABLES = new Set([
  'branch_relations',
  'branches_master',
  'ganji_master',
  'sibiunsung_lookup',
  'sipsin_lookup',
  'stem_relations',
  'stems_master',
]);

/** 계정 정보·마이그레이션 기록 테이블: user_id 컬럼이 없어 범위를 보장할 수 없으므로 읽지 않는다 */
export const BLOCKED_TABLES = new Set(['users', 'schema_migrations']);

export const MSG = {
  structure:
    '보안 규칙: 쿼리 구조를 확인할 수 없어. 단순한 SELECT/INSERT/UPDATE/DELETE 형태로 다시 써줘.',
  blockedTable: (name: string): string => `보안 규칙: ${name} 테이블은 쓸 수 없어.`,
  noUserColumn:
    '보안 규칙: user_id 컬럼이 없는 테이블만 읽는 곳에는 user_id 조건을 쓸 수 없어. 그 조건을 빼줘.',
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
