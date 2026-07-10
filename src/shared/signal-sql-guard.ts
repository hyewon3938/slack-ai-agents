/**
 * LLM 신호 SQL 게이트 #1 — 정적 검증 (#477 P5b, ADR-0040).
 *
 * LLM이 자율 생성한 측정 SQL은 untrusted 입력으로 다룬다. 승인 시점(actions.approveLlmSignal)과
 * 실행 시점(pattern-match.runLlmSignalSql) 양쪽에서 이 검증을 통과해야만 prod DB에 닿는다(2단 방어).
 *
 * 검증은 self-contained — db-proxy.ts BLOCKED_PATTERNS / sql-tools.ts 검증과 같은 정신이나
 * 의도적으로 이 파일 안에 복제했다(보안 경계를 한 파일에서 감사 가능하게 + 외부 리팩토링이 조용히
 * 약화시키지 못하게). 문자열·주석 스트리핑은 db-proxy 등급(이스케이프된 '' 처리).
 *
 * deny-by-default: 통과 시 null, 실패 시 한글 사유 문자열.
 */

/** 단일 숫자 결과를 기대 — 방어적 상한. 정상 신호는 1행을 넘지 않는다(read-only TX row cap). */
export const SIGNAL_ROW_CAP = 5;

const MAX_SIGNAL_SQL_LENGTH = 2000;

/**
 * LLM sql 신호가 읽을 수 있는 테이블 (deny-by-default 화이트리스트).
 * 빌드 시점 prod introspection으로 확정 — 활성 시드 sql 신호가 실제 참조하는 행동 데이터 테이블 +
 * 같은 5개 신호 도메인(schedule·routine·sleep·expense·diary_meta)의 실존 테이블만.
 *
 * 의도적 제외:
 *   - 재정 테이블(assets·incomes·budget_*·fixed_cost*·category_limits·planned_expenses 등)
 *     — 신호 도메인 밖 + 민감(금액·자산·수입·고정비).
 *   - 시스템·메타(signal_defs·pattern_links·pattern_catalog·users·custom_instructions·
 *     notification_settings·slack_user_mappings 등) — 자기승인·프롬프트 변조·교차유저 차단.
 *   - 사주 내부·마스터·룩업(saju_profiles·*_master·*_lookup·branch_relations 등) — 측정 대상 아님.
 *   - diary_entries(일기 원문) — 헌장 ①(원문 0). 일기 신호는 메타 태그(diary_meta_tags)로만.
 */
export const SIGNAL_TABLE_WHITELIST: ReadonlySet<string> = new Set([
  // schedule
  'schedules',
  // schedule_changes의 delete_reason_text(사용자 원문, #590)는 헌장 ① 대상 —
  // 화이트리스트는 테이블 단위라 BLOCKED_PATTERNS에서 컬럼명으로 정적 차단.
  'schedule_changes',
  // routine
  'routine_templates',
  'routine_records',
  'routine_inactive_periods',
  // sleep
  'sleep_records',
  'sleep_events',
  // expense (금액은 private DB→private Slack에만 — 공개로 안 나감. 기존 시드 신호도 사용.)
  'expenses',
  'categories',
  // diary (메타 태그만 — 원문 diary_entries 제외)
  'diary_meta_tags',
]);

const ALLOWED_FIRST_KEYWORDS: ReadonlySet<string> = new Set(['SELECT', 'WITH']);

/**
 * 차단 패턴 (db-proxy.ts BLOCKED_PATTERNS 정렬 + DML 전수).
 * sql 신호는 읽기 전용이어야 하므로 db-proxy가 허용하는 INSERT/UPDATE/DELETE도 차단한다.
 * information_schema·pg_catalog는 스키마 탐색 방지.
 */
const BLOCKED_PATTERNS: readonly RegExp[] = [
  /\bDROP\b/i,
  /\bTRUNCATE\b/i,
  /\bALTER\b/i,
  /\bCREATE\b/i,
  /\bGRANT\b/i,
  /\bREVOKE\b/i,
  /\bINSERT\b/i,
  /\bUPDATE\b/i,
  /\bDELETE\b/i,
  /\bMERGE\b/i,
  /\bCOPY\b/i,
  /\bDO\b\s*\$/i, // anonymous code block
  /\bCALL\b/i,
  /\bpg_read_file\b/i,
  /\bpg_ls_dir\b/i,
  /\bpg_stat_file\b/i,
  /\bpg_read_binary_file\b/i,
  /\blo_import\b/i,
  /\blo_export\b/i,
  /\bpg_sleep\b/i,
  /\bset_config\b/i,
  /\bdblink/i,
  /\bpg_hba_file_rules\b/i,
  /\binformation_schema\b/i,
  /\bpg_catalog\b/i,
  // 삭제 사유 원문 컬럼 (#590 ADR-0060) — 헌장 ①(원문 0). 신호화는 delete_reason_category만.
  /\bdelete_reason_text\b/i,
];

/** 주석·문자열 리터럴 제거 (db-proxy 등급 — 이스케이프된 '' 처리). */
const stripCommentsAndStrings = (sql: string): string =>
  sql
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/--[^\n]*/g, '') // line comments
    .replace(/'(?:''|[^'])*'/g, '') // single-quoted strings (escaped '' 포함)
    .replace(/"[^"]*"/g, ''); // double-quoted identifiers

const firstKeyword = (stripped: string): string => {
  const match = /^\s*(\w+)/.exec(stripped);
  return (match?.[1] ?? '').toUpperCase();
};

const hasMultipleStatements = (stripped: string): boolean =>
  stripped.split(';').filter((s) => s.trim().length > 0).length > 1;

/**
 * EXTRACT(field FROM expr)의 내부 FROM은 테이블 참조가 아니다(예: EXTRACT(EPOCH FROM min(...))).
 * 테이블 토큰 추출 전 제거해 오탐을 막는다 — prod 시드 신호에서 'min' 오탐 실측됨.
 */
const stripExtractExpressions = (stripped: string): string =>
  stripped.replace(/\bEXTRACT\s*\([^)]*\)/gi, ' ');

/**
 * CTE 이름 수집 — `WITH x AS (...)`, `, y AS (...)`. FROM 토큰 화이트리스트 검사 시 허용한다.
 * CTE 참조(FROM x)는 파생 테이블이라 화이트리스트 밖이어도 정당 — 'rc' 오탐 실측됨.
 */
const collectCteNames = (stripped: string): Set<string> => {
  const names = new Set<string>();
  const re = /([a-zA-Z_]\w*)\s+AS\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    if (m[1]) names.add(m[1].toLowerCase());
  }
  return names;
};

/** FROM/JOIN 뒤 테이블 토큰 추출 (소문자). */
const extractTableTokens = (cleaned: string): string[] => {
  const tokens: string[] = [];
  const re = /\b(?:FROM|JOIN)\s+([a-zA-Z_]\w*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    if (m[1]) tokens.push(m[1].toLowerCase());
  }
  return tokens;
};

/**
 * LLM 신호 SQL 게이트 #1 정적 검증. 통과 시 null, 실패 시 한글 사유.
 * 빠른 실패 순서: 길이 → 단일문 → SELECT/WITH → 블록패턴 → 플레이스홀더($1/$2만) →
 *               테이블 화이트리스트(EXTRACT 제거 + CTE 허용) → user_id=$1 스코프.
 */
export const validateSignalSql = (sqlBody: string): string | null => {
  if (typeof sqlBody !== 'string' || sqlBody.trim().length === 0) {
    return 'SQL이 비어 있어.';
  }
  if (sqlBody.length > MAX_SIGNAL_SQL_LENGTH) {
    return `SQL이 너무 길어 (${sqlBody.length} > ${MAX_SIGNAL_SQL_LENGTH}).`;
  }

  const stripped = stripCommentsAndStrings(sqlBody);

  if (hasMultipleStatements(stripped)) {
    return '여러 SQL 문은 허용 안 돼 — 단일 SELECT만.';
  }
  if (!ALLOWED_FIRST_KEYWORDS.has(firstKeyword(stripped))) {
    return 'SELECT/WITH로 시작하는 읽기 쿼리만 허용돼.';
  }
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(stripped)) {
      return `금지된 키워드/함수가 포함됐어 (${pattern.source}).`;
    }
  }

  // 플레이스홀더는 $1(userId)·$2(date)만 — runLlmSignalSql이 그 둘만 치환한다.
  for (const m of stripped.matchAll(/\$(\d+)/g)) {
    if (m[1] !== '1' && m[1] !== '2') {
      return `허용되지 않은 플레이스홀더 $${m[1]} — $1(userId)·$2(date)만 가능.`;
    }
  }

  // 테이블 화이트리스트 (deny-by-default). EXTRACT 내부 FROM 제거 + CTE 이름 허용(오탐 방지).
  const cleaned = stripExtractExpressions(stripped);
  const cteNames = collectCteNames(stripped);
  const tables = extractTableTokens(cleaned);
  for (const t of tables) {
    if (SIGNAL_TABLE_WHITELIST.has(t) || cteNames.has(t)) continue;
    return `화이트리스트 밖 테이블 참조: ${t}.`;
  }

  // user_id 스코프 — 실제(화이트리스트) 테이블을 참조하면 user_id = $1 필수(교차유저 차단).
  const referencesRealTable = tables.some((t) => SIGNAL_TABLE_WHITELIST.has(t));
  if (referencesRealTable && !/\buser_id\s*=\s*\$1\b/.test(stripped)) {
    return 'user_id = $1 필터가 필요해 (본인 데이터만).';
  }

  return null;
};
