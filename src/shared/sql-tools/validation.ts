/**
 * SQL 검증: 구문 검증과 보안 검증 (user_id 필터, custom_instructions).
 */

// ---- SQL 검증 ----

/** SQL에서 주석과 문자열 리터럴 제거 (보안 검증용 공통 유틸) */
const stripCommentsAndStrings = (sql: string): string =>
  sql
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/--[^\n]*/g, '') // line comments
    .replace(/'[^']*'/g, '') // single-quoted strings
    .replace(/"[^"]*"/g, ''); // double-quoted strings

/** SQL 앞쪽 주석 제거 후 첫 키워드 추출 */
export const extractFirstKeyword = (sql: string): string => {
  const cleaned = sql
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/--[^\n]*/g, '') // line comments
    .trim();
  const match = /^(\w+)/i.exec(cleaned);
  return (match?.[1] ?? '').toUpperCase();
};

/** 복수 SQL 문 감지 (주석·문자열 리터럴 내 세미콜론 제외) */
export const hasMultipleStatements = (sql: string): boolean => {
  const stripped = stripCommentsAndStrings(sql);
  const parts = stripped.split(';').filter((s) => s.trim().length > 0);
  return parts.length > 1;
};

const DANGEROUS_DDL = new Set(['DROP', 'TRUNCATE', 'ALTER', 'CREATE', 'GRANT', 'REVOKE']);

/** SELECT 쿼리 검증. 통과 시 null, 실패 시 에러 메시지 반환 */
export const validateSelectQuery = (sql: string): string | null => {
  if (hasMultipleStatements(sql)) {
    return '여러 SQL 문은 실행할 수 없어. 하나씩 실행해줘.';
  }
  const keyword = extractFirstKeyword(sql);
  if (keyword !== 'SELECT' && keyword !== 'WITH') {
    return `query_db는 SELECT/WITH 쿼리만 실행할 수 있어. (입력: ${keyword})`;
  }
  return null;
};

/** DELETE/UPDATE 문에 WHERE 절이 있는지 검증 */
export const hasWhereClause = (sql: string): boolean => {
  const stripped = stripCommentsAndStrings(sql);
  return /\bWHERE\b/i.test(stripped);
};

/** 변경 쿼리 검증. 통과 시 null, 실패 시 에러 메시지 반환 */
export const validateModifyQuery = (sql: string): string | null => {
  if (hasMultipleStatements(sql)) {
    return '여러 SQL 문은 실행할 수 없어. 하나씩 실행해줘.';
  }
  const keyword = extractFirstKeyword(sql);
  if (DANGEROUS_DDL.has(keyword)) {
    return `${keyword} 문은 안전상 실행할 수 없어.`;
  }
  const ALLOWED = new Set(['INSERT', 'UPDATE', 'DELETE']);
  if (!ALLOWED.has(keyword)) {
    return `modify_db는 INSERT/UPDATE/DELETE만 실행할 수 없어. (입력: ${keyword})`;
  }
  if ((keyword === 'DELETE' || keyword === 'UPDATE') && !hasWhereClause(sql)) {
    return `${keyword} 문에는 반드시 WHERE 절이 필요해. 전체 행 변경은 허용되지 않아.`;
  }
  return null;
};

// ---- 보안 검증 ----

/** user_id 컬럼이 없는 테이블 (user_id 필터 검증 면제) */
const USER_ID_EXEMPT_TABLES = new Set([
  'sleep_events',
  'notification_settings',
  'categories',
  'reminders',
]);

/**
 * SQL에 user_id = {userId} 필터가 정확히 포함되어 있는지 검증.
 * - SELECT/UPDATE/DELETE: user_id = {userId} 조건 필수 (다른 user_id 값 차단)
 * - INSERT: user_id 컬럼 포함 여부 확인
 * - 면제 테이블만 참조하는 쿼리 및 information_schema 쿼리는 통과.
 * 통과 시 null, 실패 시 에러 메시지 반환.
 */
export const validateUserIdFilter = (sql: string, userId: number): string | null => {
  const stripped = stripCommentsAndStrings(sql);

  // information_schema 쿼리는 OK (get_schema 도구용)
  if (/\binformation_schema\b/i.test(stripped)) return null;

  // FROM/JOIN/INTO/UPDATE 뒤의 테이블명 추출
  const tableMatches = stripped.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi);
  const tables = [...tableMatches].map((m) => (m[1] ?? '').toLowerCase());

  // 테이블 참조가 없는 순수 계산 쿼리는 OK (SELECT EXTRACT(...), SELECT 470 등)
  if (tables.length === 0) return null;

  // 추출된 테이블이 모두 면제 대상이면 OK
  if (tables.every((t) => USER_ID_EXEMPT_TABLES.has(t))) {
    return null;
  }

  const keyword = extractFirstKeyword(stripped);

  // INSERT: user_id 컬럼이 포함되어야 함
  if (keyword === 'INSERT') {
    if (/\buser_id\b/i.test(stripped)) return null;
    return '보안 규칙: INSERT에 user_id 컬럼을 포함해줘.';
  }

  // SELECT/UPDATE/DELETE: user_id = {userId} 정확히 매칭 (다른 숫자 차단)
  const exactPattern = new RegExp(`\\buser_id\\s*=\\s*${userId}\\b`, 'i');
  if (exactPattern.test(stripped)) return null;

  // user_id = (다른 값) 시도 감지
  if (/\buser_id\s*=/i.test(stripped)) {
    return `보안 규칙: user_id = ${userId}만 허용돼. 다른 user_id 값은 사용할 수 없어.`;
  }

  return `보안 규칙: 이 쿼리에는 user_id = ${userId} 조건이 필요해.`;
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
