import { describe, it, expect } from 'vitest';
import {
  validateSelectQuery,
  validateModifyQuery,
  validateUserIdFilter,
} from '../sql-tools/validation.js';
import {
  type Token,
  tokenize,
  hasStatementAfterSemicolon,
  withoutTrailingSemicolon,
} from '../sql-tools/sql-lexer.js';

const USER_ID = 1;

/** query_db 경로: 조회 검증 → user_id 범위 검증 */
const checkQuery = (sql: string): string | null =>
  validateSelectQuery(sql) ?? validateUserIdFilter(sql, USER_ID);

/** modify_db 경로: 변경 검증 → user_id 범위 검증 */
const checkModify = (sql: string): string | null =>
  validateModifyQuery(sql) ?? validateUserIdFilter(sql, USER_ID);

const OTHER_USER = /다른 user_id 값/;
const COVERAGE = /user_id = 1 조건이 필요해/;

describe('sql-lexer', () => {
  const tokensOf = (sql: string): Token[] => {
    const lexed = tokenize(sql);
    if (!lexed.ok) throw new Error(lexed.reason);
    return lexed.tokens;
  };

  it('중첩 주석을 하나의 주석으로 읽는다', () => {
    const tokens = tokensOf('SELECT 1 /* a /* b */ c */ ; DROP');
    expect(tokens.map((t) => t.value)).toEqual(['select', '1', ';', 'drop']);
    expect(hasStatementAfterSemicolon(tokens)).toBe(true);
  });

  it('달러 인용 안의 세미콜론은 문장 구분이 아니다', () => {
    expect(hasStatementAfterSemicolon(tokensOf('SELECT $x$ ; DROP $x$'))).toBe(false);
  });

  it('E 문자열의 역슬래시 이스케이프를 따른다', () => {
    const tokens = tokensOf("SELECT E'\\'; DROP'");
    expect(tokens.filter((t) => t.kind === 'string')).toHaveLength(1);
    expect(hasStatementAfterSemicolon(tokens)).toBe(false);
  });

  it.each([
    ['닫히지 않은 문자열', "SELECT 'a"],
    ['닫히지 않은 주석', 'SELECT /* a'],
    ['닫히지 않은 달러 인용', 'SELECT $a$ x'],
    ['닫히지 않은 큰따옴표', 'SELECT "a'],
    ['짝이 맞지 않는 괄호', 'SELECT (1'],
    ['유니코드 이스케이프 문자열', "SELECT U&'\\0041'"],
  ])('해석할 수 없는 입력은 오류로 돌려준다: %s', (_name, sql) => {
    expect(tokenize(sql).ok).toBe(false);
  });

  it('끝의 세미콜론 하나는 떼어낸다', () => {
    expect(withoutTrailingSemicolon(tokensOf('SELECT 1 ;')).map((t) => t.value)).toEqual(['select', '1']);
  });

  it('16진 리터럴 뒤 주석을 DB와 같게 해석', () => {
    expect(tokensOf('SELECT 0xe-- AND x').map((t) => t.value)).toEqual(['select', '0xe']);
    expect(tokensOf('SELECT 0xe-f(1)').map((t) => t.value)).toEqual(['select', '0xe', '-', 'f', '(', '1', ')']);
  });

  it.each([
    ['정수', '42'],
    ['밑줄 구분', '1_000'],
    ['지수', '1e3'],
    ['부호 있는 지수', '1E+3'],
    ['음수 지수 소수', '.5e-2'],
    ['소수점으로 끝나는 수', '1.'],
    ['점 뒤 지수', '1.e3'],
    ['16진', '0x1F'],
    ['밑줄 뒤 16진', '0x_1F'],
    ['8진', '0o17'],
    ['2진', '0b101'],
  ])('숫자 리터럴을 한 토큰으로 읽는다: %s', (_name, literal) => {
    expect(tokensOf(`SELECT ${literal}`).map((t) => t.value)).toEqual(['select', literal]);
  });

  it.each([
    ['숫자 없는 16진 접두', 'SELECT 0x'],
    ['숫자 없는 지수', 'SELECT 1e'],
    ['부호 뒤 숫자 없는 지수', 'SELECT 1e+'],
    ['숫자 뒤 이어진 문자', 'SELECT 1ex'],
    ['진법 밖 숫자', 'SELECT 0b12'],
    ['파라미터 뒤 이어진 문자', 'SELECT $1abc'],
    ['별칭 자리의 CASE', 'SELECT 1 case FROM schedules'],
    ['괄호 뒤 CASE', 'SELECT (1) case FROM schedules'],
    ['닫히지 않은 CASE', 'SELECT CASE WHEN true THEN 1 FROM schedules'],
  ])('DB가 오류로 보거나 다르게 읽을 수 있는 표기는 거절: %s', (_name, sql) => {
    expect(tokenize(sql).ok).toBe(false);
  });

  it('점 뒤와 AS 뒤의 단어는 이름으로 표시한다', () => {
    const tokens = tokensOf('SELECT x.case AS where FROM t');
    expect(tokens.filter((t) => t.ident).map((t) => t.value)).toEqual(['case', 'where']);
  });

  it('CTE의 AS [NOT] MATERIALIZED는 키워드로 둔다', () => {
    const tokens = tokensOf('WITH c AS NOT MATERIALIZED (SELECT 1) SELECT * FROM c');
    expect(tokens.some((t) => t.ident)).toBe(false);
  });
});

describe('user_id 범위 — 토큰 해석을 DB 문법에 맞춤', () => {
  it.each([
    ['16진 뒤 주석 (조회)', 'SELECT * FROM schedules WHERE id > 0xe-- AND user_id = 1'],
    ['16진 뒤 주석 (UPDATE)', "UPDATE schedules SET title = 'x' WHERE id = 0x1e-- AND user_id = 1"],
    ['16진 뒤 주석 (DELETE)', 'DELETE FROM schedules WHERE id > 0xe-- AND user_id = 1'],
    ['점 뒤 case', 'SELECT s.* FROM schedules s, (SELECT true AS "case") x WHERE s.user_id = 1 AND x.case OR true'],
    ['점 뒤 where', 'SELECT s.* FROM schedules s JOIN (SELECT true AS "where") x ON true OR x.where AND s.user_id = 1'],
    [
      '점 뒤 end',
      'SELECT s.* FROM schedules s, (SELECT true AS "end") x WHERE CASE WHEN x.end AND s.user_id = 1 AND true THEN true ELSE true END',
    ],
    [
      'UPDATE FROM의 점 뒤 case',
      'UPDATE schedules s SET title = \'x\' FROM (SELECT true AS "case") x WHERE s.user_id = 1 AND x.case OR s.id = 30',
    ],
    [
      'DELETE USING의 점 뒤 case',
      'DELETE FROM schedules s USING (SELECT true AS "case") x WHERE s.user_id = 1 AND x.case OR s.id = 31',
    ],
  ])('user_id 조건이 보장되지 않는 것으로 본다: %s', (_name, sql) => {
    const isModify = /^(UPDATE|DELETE)/.test(sql);
    expect(isModify ? checkModify(sql) : checkQuery(sql)).toMatch(COVERAGE);
  });

  it.each([
    "SELECT 0xe-setval('schedules_id_seq', 1)",
    "SELECT 0xe-nextval('schedules_id_seq')",
    "SELECT 0xe-query_to_xml('select * from schedules', true, false, '')::text::int",
    "SELECT 0xe-pg_read_file('/etc/hostname')::int",
    'SELECT 0xe-pg_terminate_backend(0)::int',
    'SELECT 0xe-lo_unlink(1)',
  ])('16진 리터럴 뒤 함수 이름도 함수로 읽는다: %s', (sql) => {
    expect(checkQuery(sql)).toMatch(/시스템 함수/);
  });

  it.each([
    ['별칭 자리의 case', 'SELECT 1 case FROM schedules'],
    ['별칭 자리의 case와 end', 'SELECT title case, 2 end FROM schedules WHERE user_id = 1'],
    ['별 뒤 case', 'SELECT s.* case FROM schedules s WHERE s.user_id = 1'],
    ['RETURNING 별칭 자리의 case', 'DELETE FROM schedules WHERE user_id = 1 RETURNING id case'],
  ])('범위를 정할 수 없는 CASE는 해석 오류로 거절: %s', (_name, sql) => {
    const isModify = sql.startsWith('DELETE');
    expect(isModify ? checkModify(sql) : checkQuery(sql)).toMatch(/SQL을 해석할 수 없어/);
  });

  it.each([
    ['16진 비교', 'SELECT * FROM schedules WHERE user_id = 1 AND id > 0x1F'],
    ['지수 표기', 'SELECT * FROM schedules WHERE user_id = 1 AND id < 1e3'],
    ['여러 숫자 표기', 'SELECT * FROM schedules WHERE user_id = 1 AND id < 1E+3 AND id > .5 AND id <> 1_000'],
    ['end_date 컬럼', 'SELECT s.end_date, s.title FROM schedules s WHERE s.user_id = 1'],
    ['type 컬럼', 'SELECT c.type, c.name FROM categories c WHERE c.user_id = 1'],
    ['별칭 컬럼 정렬', 'SELECT x.name FROM schedules x WHERE x.user_id = 1 ORDER BY x.end_date'],
    ['곱셈 뒤 CASE', "SELECT id * CASE WHEN status = 'done' THEN 1 ELSE 0 END AS score FROM schedules WHERE user_id = 1"],
    ['ORDER BY CASE', "SELECT id FROM schedules WHERE user_id = 1 ORDER BY CASE WHEN status = 'done' THEN 1 ELSE 0 END"],
    ['GROUP BY CASE', "SELECT COUNT(*) FROM schedules WHERE user_id = 1 GROUP BY CASE WHEN id > 1 THEN 'a' END"],
    ['집계 안 CASE', "SELECT SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) FROM schedules WHERE user_id = 1"],
    ['NOT MATERIALIZED CTE', 'WITH c AS NOT MATERIALIZED (SELECT * FROM schedules WHERE user_id = 1) SELECT * FROM c'],
    ['AS 뒤 키워드 별칭', 'SELECT true AS where FROM schedules WHERE user_id = 1'],
    ['점 뒤 키워드 컬럼', 'SELECT s.id, x.from FROM schedules s, (SELECT 1 AS from) x WHERE s.user_id = 1'],
    ['CAST AS 타입', 'SELECT CAST(id AS text) FROM schedules WHERE user_id = 1'],
  ])('정상 형태는 통과: %s', (_name, sql) => {
    expect(checkQuery(sql)).toBeNull();
  });
});

describe('user_id 범위 — 봇이 쓰는 정상 조회는 통과', () => {
  it.each([
    [
      '오늘 일정',
      "SELECT * FROM schedules WHERE user_id = 1 AND status != 'cancelled' AND (date = '2026-11-25' OR (date <= '2026-11-25' AND end_date >= '2026-11-25'))",
    ],
    [
      'LEFT JOIN 카테고리',
      "SELECT s.*, c.name FROM schedules s LEFT JOIN categories c ON c.id = s.category_id AND c.user_id = 1 LEFT JOIN categories p ON p.id = c.parent_id AND p.user_id = 1 WHERE s.user_id = 1 ORDER BY CASE WHEN c.type = 'event' THEN 0 ELSE 1 END",
    ],
    ['카테고리 단독 조회', "SELECT id, name FROM categories WHERE user_id = 1 AND name = '업무'"],
    ['중간 기상 조회', "SELECT event_time, memo FROM sleep_events WHERE user_id = 1 AND date = '2026-11-25'"],
    ['테이블 없는 계산', "SELECT ('2026-11-25'::date + n)::text FROM generate_series(1,7) n LIMIT 1;"],
    [
      '교차 분석 JOIN (등식 연결)',
      'SELECT s.date FROM sleep_records s JOIN routine_records r ON s.date = r.date AND r.user_id = s.user_id JOIN routine_templates t ON r.template_id = t.id AND t.user_id = r.user_id WHERE s.user_id = 1',
    ],
    [
      '교차 분석 JOIN (테이블별 조건)',
      'SELECT t.time_slot FROM routine_records r JOIN routine_templates t ON r.template_id = t.id WHERE r.user_id = 1 AND t.user_id = 1 GROUP BY t.time_slot',
    ],
    ['CTE', "WITH recent AS (SELECT * FROM expenses WHERE user_id = 1) SELECT category, SUM(amount) FROM recent GROUP BY category"],
    ['UNION ALL', 'SELECT * FROM schedules WHERE user_id = 1 UNION ALL SELECT * FROM schedules WHERE user_id = 1 AND id > 3'],
    ['IN 서브쿼리', 'SELECT * FROM schedules WHERE user_id = 1 AND id IN (SELECT schedule_id FROM schedule_changes WHERE user_id = 1)'],
    [
      'EXISTS 서브쿼리',
      'SELECT * FROM schedules WHERE user_id = 1 AND EXISTS (SELECT 1 FROM routine_records r WHERE r.user_id = 1 AND r.date = schedules.date)',
    ],
    [
      'LATERAL',
      'SELECT * FROM schedules s JOIN LATERAL (SELECT count(*) FROM routine_records r WHERE r.user_id = 1 AND r.date = s.date) c ON true WHERE s.user_id = 1',
    ],
    ['FROM 서브쿼리', 'SELECT x.* FROM (SELECT * FROM schedules WHERE user_id = 1) x'],
    ['information_schema', "SELECT column_name FROM information_schema.columns WHERE table_name = 'schedules'"],
    ['user_id 없는 테이블', 'SELECT * FROM notification_settings'],
    ['user_id 없는 테이블 (리마인더)', 'SELECT * FROM reminders WHERE active = true'],
    ['OR 가지마다 user_id', 'SELECT * FROM schedules WHERE (user_id = 1 AND a = 1) OR (user_id = 1 AND b = 2)'],
    ['쉼표 조인 + 등식 연결', 'SELECT count(*) FROM schedules s, routine_records r WHERE s.user_id = 1 AND r.user_id = s.user_id'],
    ['대소문자·공백 변형', 'select * from SCHEDULES where USER_ID=1'],
    ['BETWEEN과 함께', "SELECT * FROM schedules WHERE user_id = 1 AND date BETWEEN '2026-11-01' AND '2026-11-30' AND status = 'todo'"],
    ['DISTINCT ON', 'SELECT DISTINCT ON (date) date, title FROM schedules WHERE user_id = 1 ORDER BY date, id DESC'],
    ['IS DISTINCT FROM', "SELECT * FROM schedules WHERE user_id = 1 AND title IS DISTINCT FROM 'x'"],
    ['WITHIN GROUP', 'SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_minutes) FROM sleep_records WHERE user_id = 1'],
    ['집계 ORDER BY', "SELECT string_agg(title, ', ' ORDER BY date) FROM schedules WHERE user_id = 1"],
    ['HAVING·LIMIT·OFFSET', 'SELECT date_trunc(\'month\', date) m, sum(amount) FROM expenses WHERE user_id = 1 GROUP BY 1 HAVING sum(amount) > 0 ORDER BY 1 DESC LIMIT 5 OFFSET 0'],
  ])('%s', (_name, sql) => {
    expect(checkQuery(sql)).toBeNull();
  });
});

describe('user_id 범위 — 읽는 테이블마다 user_id = N 보장', () => {
  it.each([
    ['OR로 조건을 넓히면 보장이 없다', 'SELECT * FROM schedules WHERE user_id = 1 OR 1=1'],
    ['역방향 등식도 OR로 넓히면 보장이 없다', 'SELECT * FROM schedules WHERE 1 = user_id OR true'],
    ['UNION 가지마다 필요하다', 'SELECT * FROM schedules WHERE user_id = 1 UNION SELECT * FROM schedules'],
    ['IN 서브쿼리에도 필요하다', 'SELECT * FROM schedules WHERE user_id = 1 AND id IN (SELECT id FROM expenses)'],
    ['비교 서브쿼리에도 필요하다', 'SELECT * FROM schedules WHERE user_id = 1 AND id = (SELECT max(id) FROM schedules)'],
    ['SELECT 목록 서브쿼리에도 필요하다', 'SELECT (SELECT title FROM schedules LIMIT 1)'],
    ['CTE 본문에도 필요하다', 'WITH x AS (SELECT * FROM expenses) SELECT * FROM x'],
    ['재귀 CTE 바깥 테이블에도 필요하다', 'WITH RECURSIVE r AS (SELECT 1 n UNION ALL SELECT n+1 FROM r) SELECT * FROM r, expenses'],
    ['조건 없는 JOIN 테이블에도 필요하다', 'SELECT * FROM schedules s JOIN expenses e ON true WHERE s.user_id = 1'],
    ['RIGHT JOIN의 등식 연결은 보장으로 치지 않는다', 'SELECT * FROM schedules s RIGHT JOIN expenses e ON e.user_id = s.user_id WHERE s.user_id = 1'],
    [
      'LEFT JOIN 테이블은 OR 조건으로 보장되지 않는다',
      'SELECT * FROM schedules s LEFT JOIN expenses e ON e.user_id = s.user_id WHERE s.user_id = 1 OR e.user_id = 1',
    ],
    ['테이블이 여럿이면 한정자 없는 user_id는 인정하지 않는다', 'SELECT * FROM schedules s, expenses e WHERE user_id = 1'],
    ['주석 안의 조건은 조건이 아니다', "SELECT * FROM schedules /* user_id = 1 */ WHERE title = '-- user_id = 1'"],
    ['달러 인용 안의 조건은 조건이 아니다', 'SELECT * FROM schedules WHERE title = $$ user_id = 1 $$'],
    ['E 문자열 안의 조건은 조건이 아니다', "SELECT * FROM schedules WHERE title = E'\\' user_id = 1 --'"],
    ['categories에도 필요하다', 'SELECT * FROM categories'],
    ['sleep_events에도 필요하다', "SELECT * FROM sleep_events WHERE date = '2026-11-25'"],
    [
      'LEFT JOIN categories에도 필요하다',
      'SELECT s.title, c.name FROM schedules s LEFT JOIN categories c ON c.id = s.category_id WHERE s.user_id = 1',
    ],
    [
      'LEFT JOIN 부모 카테고리에도 필요하다',
      'SELECT s.title FROM schedules s LEFT JOIN categories c ON c.id = s.category_id AND c.user_id = 1 LEFT JOIN categories p ON p.id = c.parent_id WHERE s.user_id = 1',
    ],
  ])('%s', (_name, sql) => {
    expect(checkQuery(sql)).toMatch(COVERAGE);
  });
});

describe('user_id 범위 — N 이외의 user_id 값 금지', () => {
  it.each([
    ['다른 값', 'SELECT * FROM schedules WHERE user_id = 2'],
    ['OR로 다른 값 추가', 'SELECT * FROM schedules WHERE user_id = 1 OR user_id = 2'],
    ['!=', 'SELECT * FROM schedules WHERE user_id != 1'],
    ['<>', 'SELECT * FROM schedules WHERE user_id <> 1'],
    ['IS NOT NULL', 'SELECT * FROM schedules WHERE user_id IS NOT NULL'],
    ['IN 목록', 'SELECT * FROM schedules WHERE user_id IN (1, 2)'],
    ['BETWEEN', 'SELECT * FROM schedules WHERE user_id BETWEEN 1 AND 5'],
    ['소수', 'SELECT * FROM schedules WHERE user_id = 1.0'],
    ['앞자리가 같은 다른 수', 'SELECT * FROM schedules WHERE user_id = 10'],
    ['줄바꿈 변형', 'SELECT * FROM schedules WHERE user_id\n=\n2'],
    ['큰따옴표 식별자', 'SELECT * FROM schedules WHERE "user_id" = 2'],
  ])('%s', (_name, sql) => {
    expect(checkQuery(sql)).toMatch(OTHER_USER);
  });
});

describe('조회 전용 — 시스템 함수·카탈로그·변경 키워드 금지', () => {
  it.each([
    ['서버 대기 함수', 'SELECT pg_sleep(10) FROM schedules WHERE user_id = 1'],
    ['파일 읽기 함수', "SELECT pg_read_file('x')"],
    ['설정 변경 함수', "SELECT set_config('x', 'y', false)"],
    ['설정 조회 함수', "SELECT current_setting('x')"],
    ['외부 연결 함수', "SELECT * FROM dblink('x', 'y') AS t(a int)"],
    ['대형 객체 함수', "SELECT lo_import('x')"],
    ['문자열 SQL 실행 함수', "SELECT query_to_xml('select 1', true, true, '')"],
    ['pg_catalog', 'SELECT * FROM pg_catalog.pg_tables'],
    ['대문자 카탈로그', 'SELECT * FROM PG_CATALOG.PG_USER'],
  ])('%s', (_name, sql) => {
    expect(checkQuery(sql)).toMatch(/시스템 함수나 시스템 카탈로그/);
  });

  it.each([
    ['SELECT INTO', 'SELECT * INTO t2 FROM schedules WHERE user_id = 1'],
    ['데이터 변경 CTE', 'WITH d AS (DELETE FROM schedules WHERE user_id = 1 RETURNING *) SELECT * FROM d'],
    ['행 잠금', 'SELECT * FROM schedules WHERE user_id = 1 FOR UPDATE'],
  ])('%s', (_name, sql) => {
    expect(checkQuery(sql)).toMatch(/query_db는 조회만/);
  });

  it('users 테이블은 쓸 수 없다', () => {
    expect(checkQuery('SELECT * FROM "users"')).toMatch(/users 테이블/);
    expect(checkQuery('SELECT * FROM users WHERE user_id = 1')).toMatch(/users 테이블/);
  });

  it('여러 문장은 거절한다', () => {
    expect(checkQuery('SELECT * FROM schedules WHERE user_id = 1; DROP TABLE schedules')).toMatch(/여러 SQL 문/);
  });

  it('닫히지 않은 문자열은 해석 오류로 거절한다', () => {
    expect(checkQuery("SELECT * FROM schedules WHERE user_id = 1 AND title = 'a")).toMatch(/해석할 수 없어/);
  });
});

describe('modify_db — 봇이 쓰는 정상 변경은 통과', () => {
  it.each([
    [
      'INSERT ... SELECT 카테고리',
      "INSERT INTO schedules (user_id, title, date, status, category_id) SELECT 1, '제목', '2026-11-25', 'todo', id FROM categories WHERE name = '업무' AND user_id = 1 LIMIT 1;",
    ],
    ['UPDATE 조건', "UPDATE sleep_records SET wake_time = '03:00' WHERE user_id = 1 AND date = '2026-04-11'"],
    ['배열 갱신', "UPDATE sleep_records SET tags = array_append(tags, '악몽') WHERE id = 3 AND user_id = 1 AND NOT ('악몽' = ANY(tags))"],
    ['E 문자열 값', "INSERT INTO sleep_records (user_id, date, memo) VALUES (1, '2026-11-25', E'첫줄\\n둘째줄')"],
    ['user_id 없는 테이블 INSERT', "INSERT INTO reminders (title, time_value) VALUES ('약', '09:00')"],
    ['user_id 없는 테이블 UPDATE', "UPDATE reminders SET active = false WHERE title LIKE '%약%'"],
    [
      'SET 서브쿼리 조건',
      "UPDATE routine_records SET memo = 'x' WHERE user_id = 1 AND template_id = (SELECT id FROM routine_templates WHERE user_id = 1 AND name LIKE '%코%')",
    ],
    ['RETURNING', 'DELETE FROM schedules WHERE user_id = 1 AND id = 3 RETURNING id, title'],
    [
      'ON CONFLICT DO NOTHING',
      "INSERT INTO routine_records (user_id, template_id, date) SELECT 1, id, '2026-11-25' FROM routine_templates WHERE user_id = 1 AND active = true ON CONFLICT (user_id, template_id, date) DO NOTHING",
    ],
    [
      'ON CONFLICT DO UPDATE (user_id 포함 대상)',
      "INSERT INTO budgets (user_id, month, amount) VALUES (1, '2026-11', 0) ON CONFLICT (user_id, month) DO UPDATE SET amount = EXCLUDED.amount",
    ],
    [
      'UPDATE ... FROM 카테고리',
      "UPDATE schedules s SET status = 'done' FROM categories c WHERE s.user_id = 1 AND c.user_id = 1 AND c.id = s.category_id",
    ],
    [
      '중간 기상 INSERT',
      "INSERT INTO sleep_events (user_id, date, event_time, memo) VALUES (1, '2026-11-25', '03:20', NULL)",
    ],
    [
      '카테고리 ON CONFLICT DO UPDATE',
      "INSERT INTO categories (user_id, name, type) VALUES (1, '운동', 'task') ON CONFLICT (user_id, name) WHERE parent_id IS NULL DO UPDATE SET type = EXCLUDED.type",
    ],
  ])('%s', (_name, sql) => {
    expect(checkModify(sql)).toBeNull();
  });
});

describe('modify_db — 변경 범위는 user_id = N 행으로 한정', () => {
  it.each([
    ['조건 없는 대상', "UPDATE schedules SET title = 'x' WHERE id = 3"],
    ['OR로 넓힌 조건', "UPDATE schedules SET title = 'x' WHERE user_id = 1 OR id = 3"],
    ['DELETE OR', 'DELETE FROM schedules WHERE user_id = 1 OR true'],
    ['USING 테이블에도 필요하다', 'DELETE FROM schedules USING expenses e WHERE schedules.user_id = 1 AND e.id = 1'],
    ['UPDATE ... FROM categories에도 필요하다', "UPDATE schedules s SET status = 'done' FROM categories c WHERE s.user_id = 1 AND c.id = s.category_id"],
    ['sleep_events DELETE에도 필요하다', 'DELETE FROM sleep_events WHERE id = 3'],
    ['INSERT ... SELECT 원본에도 필요하다', 'INSERT INTO schedules (user_id, title) SELECT 1, title FROM expenses'],
    ['SET 서브쿼리에도 필요하다', 'UPDATE schedules SET title = (SELECT title FROM expenses LIMIT 1) WHERE user_id = 1'],
    [
      'RETURNING 서브쿼리에도 필요하다',
      "INSERT INTO schedules (user_id, title) VALUES (1, 'x') RETURNING (SELECT string_agg(title, ',') FROM schedules)",
    ],
  ])('%s', (_name, sql) => {
    expect(checkModify(sql)).toMatch(COVERAGE);
  });

  it.each([
    ['다른 user_id 값', "INSERT INTO schedules (user_id, title) VALUES (2, 'x')"],
    ['여러 행 중 하나라도 다른 값', "INSERT INTO schedules (user_id, title) VALUES (1, 'x'), (2, 'y')"],
    ['계산식 값', "INSERT INTO schedules (title, user_id) VALUES ('x', 1+1)"],
    ['파라미터 값', "INSERT INTO schedules (user_id, title) VALUES ($1, 'x')"],
    ['다른 행의 user_id 복사', 'INSERT INTO schedules (user_id, title) SELECT user_id, title FROM schedules'],
    ['SET으로 다른 값 지정', 'UPDATE schedules SET user_id = 2 WHERE user_id = 1'],
    ['큰따옴표 SET', 'UPDATE schedules SET "user_id" = 2 WHERE user_id = 1'],
  ])('INSERT·SET의 user_id는 N만: %s', (_name, sql) => {
    expect(checkModify(sql)).toMatch(OTHER_USER);
  });

  it('여러 컬럼 SET으로 user_id를 바꿀 수 없다', () => {
    expect(checkModify("UPDATE schedules SET (title, user_id) = ('x', 2) WHERE user_id = 1")).toMatch(
      /user_id 값은 바꿀 수 없어/,
    );
  });

  it.each([
    ['schedules', "INSERT INTO schedules (title) VALUES ('user_id')"],
    ['sleep_events', "INSERT INTO sleep_events (date, event_time) VALUES ('2026-11-25', '03:20')"],
    ['categories', "INSERT INTO categories (name, type) VALUES ('운동', 'task')"],
  ])('INSERT는 user_id 컬럼을 명시해야 한다: %s', (_name, sql) => {
    expect(checkModify(sql)).toMatch(/user_id 컬럼을 포함/);
  });

  it('categories ON CONFLICT DO UPDATE도 충돌 대상에 user_id가 있어야 한다', () => {
    expect(
      checkModify(
        "INSERT INTO categories (user_id, name, type) VALUES (1, '운동', 'task') ON CONFLICT (name) DO UPDATE SET type = 'task'",
      ),
    ).toMatch(/충돌 대상에 user_id/);
  });

  it('ON CONFLICT DO UPDATE는 충돌 대상에 user_id가 있어야 한다', () => {
    expect(
      checkModify(
        "INSERT INTO budgets (user_id, month, amount) VALUES (1, '2026-11', 0) ON CONFLICT (month) DO UPDATE SET amount = 0",
      ),
    ).toMatch(/충돌 대상에 user_id/);
  });

  it.each([
    ['ON CONSTRAINT', "INSERT INTO budgets (user_id, month) VALUES (1, 'x') ON CONFLICT ON CONSTRAINT b_pkey DO UPDATE SET amount = 0"],
    ['커서 위치 조건', "UPDATE schedules SET title = 'x' WHERE CURRENT OF c"],
  ])('구조를 확인할 수 없는 형태는 거절: %s', (_name, sql) => {
    expect(checkModify(sql)).toMatch(/쿼리 구조를 확인할 수 없어/);
  });

  it('한 문장에 변경은 하나만', () => {
    expect(
      checkModify(
        'DELETE FROM schedules WHERE user_id = 1 AND id IN (WITH x AS (UPDATE expenses SET amount = 0 RETURNING id) SELECT id FROM x)',
      ),
    ).toMatch(/변경 하나만/);
    expect(checkModify("INSERT INTO schedules (user_id, title) VALUES (1, 'x'); DELETE FROM schedules")).toMatch(
      /여러 SQL 문/,
    );
  });

  it('users 테이블은 변경할 수 없다', () => {
    expect(checkModify('INSERT INTO users (id) VALUES (1)')).toMatch(/users 테이블/);
  });
});
