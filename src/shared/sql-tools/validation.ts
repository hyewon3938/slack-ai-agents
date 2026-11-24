/**
 * SQL 검증: 구문 검증과 보안 검증 (user_id 필터, custom_instructions).
 */

import {
  type Token,
  hasStatementAfterSemicolon,
  tokenize,
  withoutTrailingSemicolon,
} from './sql-lexer.js';
import { buildMatch, findTop, isWord } from './sql-blocks.js';
import {
  findDangerousIdentifier,
  findExtraWriteKeyword,
  findOtherUserValue,
  findWriteKeyword,
} from './sql-guards.js';
import { MSG, type ScopeCtx, analyzeQuery, fail, hasUnhandledQuery } from './user-scope.js';
import { analyzeDelete, analyzeInsert, analyzeUpdate } from './user-scope-dml.js';

// ---- SQL 검증 ----

const MULTIPLE_STATEMENTS = '여러 SQL 문은 실행할 수 없어. 하나씩 실행해줘.';
const PARSE_ERROR = (reason: string): string =>
  `SQL을 해석할 수 없어 (${reason}). 문자열·주석·괄호가 닫혔는지 확인해줘.`;

/** 토큰화 결과. 실패하면 사유 문자열 */
const lex = (sql: string): Token[] | string => {
  const result = tokenize(sql);
  return result.ok ? result.tokens : result.reason;
};

/** 주석을 건너뛴 첫 키워드 (대문자). 해석할 수 없으면 빈 문자열 */
export const extractFirstKeyword = (sql: string): string => {
  const tokens = lex(sql);
  if (typeof tokens === 'string') return '';
  const first = tokens[0];
  return first?.kind === 'word' ? first.value.toUpperCase() : '';
};

/** 복수 SQL 문 감지 (주석·문자열 안 세미콜론 제외). 해석할 수 없는 SQL도 true */
export const hasMultipleStatements = (sql: string): boolean => {
  const tokens = lex(sql);
  return typeof tokens === 'string' || hasStatementAfterSemicolon(tokens);
};

const DANGEROUS_DDL = new Set(['DROP', 'TRUNCATE', 'ALTER', 'CREATE', 'GRANT', 'REVOKE']);

/** 공통 사전 검사: 해석 가능, 단일 문장 */
const lexSingle = (sql: string): Token[] | { error: string } => {
  const tokens = lex(sql);
  if (typeof tokens === 'string') return { error: PARSE_ERROR(tokens) };
  if (hasStatementAfterSemicolon(tokens)) return { error: MULTIPLE_STATEMENTS };
  return withoutTrailingSemicolon(tokens);
};

/** SELECT 쿼리 검증. 통과 시 null, 실패 시 에러 메시지 반환 */
export const validateSelectQuery = (sql: string): string | null => {
  const tokens = lexSingle(sql);
  if ('error' in tokens) return tokens.error;
  const keyword = tokens[0]?.kind === 'word' ? tokens[0].value.toUpperCase() : '';
  if (keyword !== 'SELECT' && keyword !== 'WITH') {
    return `query_db는 SELECT/WITH 쿼리만 실행할 수 있어. (입력: ${keyword})`;
  }
  return findWriteKeyword(tokens) ?? findDangerousIdentifier(tokens);
};

/** DELETE/UPDATE 문에 (괄호 밖) WHERE 절이 있는지 검증 */
export const hasWhereClause = (sql: string): boolean => {
  const tokens = lex(sql);
  if (typeof tokens === 'string') return false;
  const ctx = { tokens, match: buildMatch(tokens), userId: 0 };
  return findTop(ctx, 0, tokens.length, (i) => isWord(tokens[i], 'where')) >= 0;
};

const ALLOWED_MODIFY = new Set(['INSERT', 'UPDATE', 'DELETE']);

/** 변경 쿼리 검증. 통과 시 null, 실패 시 에러 메시지 반환 */
export const validateModifyQuery = (sql: string): string | null => {
  const tokens = lexSingle(sql);
  if ('error' in tokens) return tokens.error;
  const keyword = tokens[0]?.kind === 'word' ? tokens[0].value.toUpperCase() : '';
  if (DANGEROUS_DDL.has(keyword)) {
    return `${keyword} 문은 안전상 실행할 수 없어.`;
  }
  if (!ALLOWED_MODIFY.has(keyword)) {
    return `modify_db는 INSERT/UPDATE/DELETE만 실행할 수 없어. (입력: ${keyword})`;
  }
  if ((keyword === 'DELETE' || keyword === 'UPDATE') && !hasWhereClause(sql)) {
    return `${keyword} 문에는 반드시 WHERE 절이 필요해. 전체 행 변경은 허용되지 않아.`;
  }
  return findExtraWriteKeyword(tokens) ?? findDangerousIdentifier(tokens);
};

// ---- 보안 검증 ----

const analyzeStatement = (ctx: ScopeCtx): void => {
  const first = ctx.tokens[0];
  const end = ctx.tokens.length;
  if (isWord(first, 'select', 'with', 'values', 'table') || first?.value === '(') {
    analyzeQuery(ctx, 0, end, new Set());
  } else if (isWord(first, 'insert')) {
    analyzeInsert(ctx, end);
  } else if (isWord(first, 'update')) {
    analyzeUpdate(ctx, end);
  } else if (isWord(first, 'delete')) {
    analyzeDelete(ctx, end);
  } else {
    fail(ctx, MSG.structure);
  }
  if (ctx.issues.length === 0 && hasUnhandledQuery(ctx)) fail(ctx, MSG.structure);
};

/**
 * 쿼리가 현재 사용자(user_id = {userId}) 데이터만 읽고 바꾸는지 검증.
 * - 조회: FROM·JOIN·서브쿼리·CTE·UNION 가지에서 읽는 테이블마다 user_id = {userId} 보장 필요
 * - UPDATE/DELETE: 대상과 FROM/USING 테이블마다 같은 보장 필요, user_id 값 변경 금지
 * - INSERT: user_id 컬럼 값이 {userId}이어야 함
 * - user_id를 {userId} 이외의 값과 비교하거나 시스템 함수·카탈로그를 쓰면 거부
 * - user_id 컬럼이 없는 면제 테이블과 information_schema는 보장 없이 허용
 * 통과 시 null, 실패 시 에러 메시지 반환.
 */
export const validateUserIdFilter = (sql: string, userId: number): string | null => {
  const lexed = lex(sql);
  if (typeof lexed === 'string') return PARSE_ERROR(lexed);
  const tokens = withoutTrailingSemicolon(lexed);
  const guard = findDangerousIdentifier(tokens) ?? findOtherUserValue(tokens, userId);
  if (guard) return guard;
  const ctx: ScopeCtx = { tokens, match: buildMatch(tokens), userId, issues: [], handled: new Set() };
  analyzeStatement(ctx);
  return ctx.issues[0] ?? null;
};

/** custom_instructions INSERT 시 시스템 프롬프트 우회 시도 감지 */
const DANGEROUS_INSTRUCTION_PATTERNS = [
  /ignore\s+(previous|all|above|system)/i,
  /disregard/i,
  /override\s+(system|rule|instruction)/i,
  /forget\s+(previous|all|everything)/i,
  /you\s+are\s+now/i,
  /new\s+instructions?:/i,
];

/**
 * custom_instructions 테이블 INSERT 시 위험 키워드 감지.
 * 통과 시 null, 실패 시 에러 메시지 반환.
 */
export const validateCustomInstruction = (sql: string): string | null => {
  if (!/\bcustom_instructions\b/i.test(sql)) return null;
  if (!/\bINSERT\b/i.test(sql)) return null;

  // 문자열 리터럴 내용 추출
  const literals = [...sql.matchAll(/'([^']*)'/g)].map((m) => m[1] ?? '');
  for (const literal of literals) {
    for (const pattern of DANGEROUS_INSTRUCTION_PATTERNS) {
      if (pattern.test(literal)) {
        return '보안 경고: 지시사항에 시스템 규칙을 우회하려는 표현이 포함되어 있어 등록할 수 없어.';
      }
    }
  }
  return null;
};
