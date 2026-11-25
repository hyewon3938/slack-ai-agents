import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  validateSelectQuery,
  validateModifyQuery,
  validateUserIdFilter,
} from '../sql-tools/validation.js';
import {
  BLOCKED_TABLES,
  SHARED_READONLY_TABLES,
  USER_ID_EXEMPT_TABLES,
} from '../sql-tools/user-scope.js';
import {
  type ModifyOp,
  TABLE_PERMISSIONS,
  getTableAccess,
  isToolModifyAllowed,
} from '../sql-tools/table-permissions.js';

const USER_ID = 1;

const checkQuery = (sql: string): string | null =>
  validateSelectQuery(sql) ?? validateUserIdFilter(sql, USER_ID);

const checkModify = (sql: string): string | null =>
  validateModifyQuery(sql) ?? validateUserIdFilter(sql, USER_ID);

const SYSTEM = /시스템 함수나 시스템 카탈로그/;
const READ_ONLY = /조회만 할 수 있어/;
const SCHEMA = /public 스키마/;
const NO_USER_COLUMN = /user_id 컬럼이 없는 테이블/;

describe('조회 전용 — 세션·저장 상태를 바꾸는 함수 금지', () => {
  it.each([
    ['난수 시드 설정', 'SELECT setseed(0.5)'],
    ['트랜잭션 번호 발급', 'SELECT txid_current()'],
    ['트랜잭션 번호 발급(신형)', 'SELECT pg_current_xact_id()'],
    ['GIN 대기 목록 정리', "SELECT gin_clean_pending_list('idx')"],
    ['BRIN 요약 생성', "SELECT brin_summarize_new_values('idx')"],
    ['BRIN 범위 요약', "SELECT brin_summarize_range('idx', 0)"],
    ['BRIN 범위 요약 해제', "SELECT brin_desummarize_range('idx', 0)"],
  ])('%s 함수는 거절한다', (_name, sql) => {
    expect(checkQuery(sql)).toMatch(SYSTEM);
  });

  it('난수·시각·집계·날짜·문자열 함수는 통과한다', () => {
    const sql =
      "SELECT random(), now(), count(*), date_trunc('day', date), upper(title), " +
      "to_char(date, 'YYYY-MM') FROM schedules WHERE user_id = 1 GROUP BY date, title";
    expect(checkQuery(sql)).toBeNull();
  });
});

describe('공용 조회 테이블 — 읽기는 조건 없이, 변경 대상은 거절', () => {
  it.each([
    ['단독 조회', 'SELECT * FROM ganji_master'],
    ['조건 조회', "SELECT * FROM sipsin_lookup WHERE day_stem = '갑'"],
    [
      '사용자 테이블과 JOIN',
      'SELECT s.title, g.name FROM schedules s JOIN ganji_master g ON g.id = s.id WHERE s.user_id = 1',
    ],
    [
      '서브쿼리',
      'SELECT * FROM schedules WHERE user_id = 1 AND id IN (SELECT id FROM stems_master)',
    ],
  ])('%s는 통과한다', (_name, sql) => {
    expect(checkQuery(sql)).toBeNull();
  });

  it.each([
    ['UPDATE', "UPDATE ganji_master SET name = 'x' WHERE id = 1"],
    ['스키마를 붙인 UPDATE', 'UPDATE public.branch_relations SET kind = 1 WHERE id = 1'],
    ['DELETE', 'DELETE FROM stems_master WHERE id = 1'],
    ['INSERT', 'INSERT INTO sipsin_lookup (day_stem) VALUES (1)'],
    ['ON CONFLICT INSERT', 'INSERT INTO sibiunsung_lookup (a) VALUES (1) ON CONFLICT DO NOTHING'],
  ])('%s 대상은 거절한다', (_name, sql) => {
    expect(checkModify(sql)).toMatch(READ_ONLY);
  });

  it.each([
    [
      'UPDATE ... FROM',
      'UPDATE schedules s SET title = g.name FROM ganji_master g WHERE s.user_id = 1 AND g.id = 1',
    ],
    ['DELETE ... USING', 'DELETE FROM schedules s USING stems_master m WHERE s.user_id = 1 AND m.id = s.id'],
    ['INSERT ... SELECT', 'INSERT INTO schedules (user_id, title) SELECT 1, name FROM ganji_master WHERE id = 1'],
    [
      '변경 조건의 서브쿼리',
      'UPDATE schedules SET title = (SELECT name FROM ganji_master WHERE id = 1) WHERE user_id = 1',
    ],
  ])('변경문이 %s로 읽는 것은 통과한다', (_name, sql) => {
    expect(checkModify(sql)).toBeNull();
  });
});

describe('차단 테이블', () => {
  it('schema_migrations 조회는 거절한다', () => {
    expect(checkQuery('SELECT * FROM schema_migrations')).toMatch(/schema_migrations 테이블은 쓸 수 없어/);
  });

  it('schema_migrations 변경은 거절한다', () => {
    expect(checkModify("INSERT INTO schema_migrations (filename) VALUES ('x')")).toMatch(
      /schema_migrations 테이블은 쓸 수 없어/,
    );
  });
});

describe('user_id 컬럼이 없는 테이블만 읽는 블록의 비한정 user_id', () => {
  it.each([
    ['면제 테이블 조회', 'SELECT * FROM reminders WHERE user_id = 1'],
    ['공용 테이블 조회', 'SELECT * FROM ganji_master WHERE user_id = 1'],
    ['따옴표 식별자', 'SELECT * FROM reminders WHERE "user_id" = 1'],
    ['JOIN 조건', 'SELECT * FROM reminders r JOIN notification_settings n ON user_id = 1'],
    [
      '서브쿼리 블록',
      'SELECT * FROM schedules s WHERE s.user_id = 1 AND EXISTS (SELECT 1 FROM ganji_master WHERE user_id = 1)',
    ],
  ])('%s는 거절한다', (_name, sql) => {
    expect(checkQuery(sql)).toMatch(NO_USER_COLUMN);
  });

  it('면제 테이블 변경 조건은 거절한다', () => {
    expect(checkModify('UPDATE reminders SET active = false WHERE user_id = 1')).toMatch(NO_USER_COLUMN);
  });

  it.each([
    ['면제 테이블 조회', 'SELECT * FROM reminders WHERE active = true'],
    ['알림 설정 조회', "SELECT * FROM notification_settings WHERE slot_name = 'morning'"],
    ['면제 테이블 변경', "UPDATE reminders SET active = false WHERE title LIKE '%약%'"],
    [
      '바깥 블록의 user_id',
      'SELECT * FROM schedules WHERE user_id = 1 AND id IN (SELECT id FROM reminders WHERE active = true)',
    ],
    ['information_schema 조회', "SELECT column_name FROM information_schema.columns WHERE table_name = 'schedules'"],
  ])('%s는 통과한다', (_name, sql) => {
    const check = sql.startsWith('UPDATE') ? checkModify : checkQuery;
    expect(check(sql)).toBeNull();
  });
});

describe('변경 대상 스키마', () => {
  it.each([
    ['UPDATE', "UPDATE other.schedules SET title = 'x' WHERE user_id = 1"],
    ['UPDATE ONLY', "UPDATE ONLY other.schedules SET title = 'x' WHERE user_id = 1"],
    ['DELETE', 'DELETE FROM other.schedules WHERE user_id = 1'],
    ['INSERT', "INSERT INTO other.schedules (user_id, title) VALUES (1, 'x')"],
    ['information_schema UPDATE', "UPDATE information_schema.columns SET column_name = 'x' WHERE table_name = 'y'"],
    ['information_schema DELETE', "DELETE FROM information_schema.columns WHERE table_name = 'y'"],
  ])('public이 아닌 스키마의 %s는 거절한다', (_name, sql) => {
    expect(checkModify(sql)).toMatch(SCHEMA);
  });

  it.each([
    ['UPDATE', "UPDATE public.schedules SET title = 'x' WHERE user_id = 1"],
    ['DELETE', 'DELETE FROM public.schedules WHERE user_id = 1'],
    ['INSERT', "INSERT INTO public.schedules (user_id, title) VALUES (1, 'x')"],
  ])('public 스키마의 %s는 통과한다', (_name, sql) => {
    expect(checkModify(sql)).toBeNull();
  });
});

// ---- 마이그레이션 정합 ----

interface Relation {
  hasUserId: boolean;
}

const NAME = '(?:public\\.)?"?([a-z_][a-z0-9_]*)"?';
const re = (source: string): RegExp => new RegExp(source, 'g');
const DDL = {
  createTable: re(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?${NAME}\\s*\\(`),
  createView: re(`create\\s+(?:or\\s+replace\\s+)?(?:materialized\\s+)?view\\s+${NAME}\\s+as([\\s\\S]*?);`),
  drop: re(`drop\\s+(?:table|view|materialized\\s+view)\\s+(?:if\\s+exists\\s+)?${NAME}`),
  rename: re(`alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?${NAME}\\s+rename\\s+to\\s+${NAME}`),
  alter: re(`alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?${NAME}([^;]*);`),
};
const HAS_USER_ID = /\buser_id\b/;
const ADD_USER_ID = /add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?user_id\b/;
const DROP_USER_ID = /drop\s+(?:column\s+)?(?:if\s+exists\s+)?user_id\b/;

/** open 위치 여는 괄호부터 짝이 맞는 닫는 괄호 앞까지 */
const parenBody = (sql: string, open: number): string => {
  let depth = 0;
  let i = open;
  for (; i < sql.length; i += 1) {
    if (sql[i] === '(') depth += 1;
    if (sql[i] === ')' && --depth === 0) break;
  }
  return sql.slice(open, i);
};

/** 마이그레이션 한 파일의 DDL을 나온 순서대로 반영 */
const applyMigration = (sql: string, rels: Map<string, Relation>): void => {
  const events: Array<[number, () => void]> = [];
  const on = (pattern: RegExp, fn: (m: RegExpMatchArray) => void): void => {
    for (const m of sql.matchAll(pattern)) events.push([m.index ?? 0, (): void => fn(m)]);
  };
  on(DDL.createTable, (m) => {
    const body = parenBody(sql, (m.index ?? 0) + m[0].length - 1);
    rels.set(m[1] ?? '', { hasUserId: HAS_USER_ID.test(body) });
  });
  on(DDL.createView, (m) => rels.set(m[1] ?? '', { hasUserId: HAS_USER_ID.test(m[2] ?? '') }));
  on(DDL.drop, (m) => rels.delete(m[1] ?? ''));
  on(DDL.rename, (m) => {
    const rel = rels.get(m[1] ?? '');
    if (!rel) return;
    rels.delete(m[1] ?? '');
    rels.set(m[2] ?? '', rel);
  });
  on(DDL.alter, (m) => {
    const rel = rels.get(m[1] ?? '');
    if (rel && ADD_USER_ID.test(m[2] ?? '')) rel.hasUserId = true;
    if (rel && DROP_USER_ID.test(m[2] ?? '')) rel.hasUserId = false;
  });
  for (const [, apply] of events.sort((a, b) => a[0] - b[0])) apply();
};

/**
 * db/migrations/*.sql을 파일 순서대로 읽어 최종 상태의 테이블·뷰와 user_id 컬럼 유무를 구한다.
 *
 * 정규식 기반이라 한계가 있다.
 * - CREATE TABLE (...) 본문, CREATE VIEW ... AS ...; 본문에 user_id 단어가 있는지만 본다.
 *   뷰는 본문 어딘가에 user_id가 있으면 컬럼으로 노출한다고 본다.
 * - ALTER TABLE ... ADD/DROP COLUMN user_id, ALTER TABLE ... RENAME TO, DROP TABLE/VIEW만 반영한다.
 *   DROP TABLE a, b처럼 여러 이름을 한 번에 지우면 첫 이름만 반영한다.
 * - CREATE TABLE ... AS, 동적 SQL(EXECUTE), DO 블록 안의 조건부 DDL은 해석하지 않는다.
 * - 마이그레이션 밖에서 만드는 테이블(schema_migrations)은 대상이 아니다.
 */
const collectRelations = (dir: string): Map<string, Relation> => {
  const rels = new Map<string, Relation>();
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = readFileSync(join(dir, file), 'utf8')
      .replace(/--[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .toLowerCase();
    applyMigration(sql, rels);
  }
  return rels;
};

describe('마이그레이션 정합 — user_id 컬럼이 없는 테이블·뷰는 모두 목록에 있다', () => {
  const rels = collectRelations(join(import.meta.dirname, '../../../db/migrations'));

  it('마이그레이션에서 테이블을 읽어온다', () => {
    expect(rels.size).toBeGreaterThan(20);
    expect(rels.get('schedules')?.hasUserId).toBe(true);
  });

  it('user_id 컬럼이 없는 테이블·뷰는 면제·공용 조회·차단 목록 중 하나에 있다', () => {
    const listed = new Set([...USER_ID_EXEMPT_TABLES, ...SHARED_READONLY_TABLES, ...BLOCKED_TABLES]);
    const unlisted = [...rels]
      .filter(([table, rel]) => !rel.hasUserId && !listed.has(table))
      .map(([table]) => table);
    expect(unlisted).toEqual([]);
  });
});

// ---- 도구 역할 권한 목록 정합 (ADR-0067) ----

describe('도구 역할 권한 목록 — 마이그레이션·SQL 검사와 정합', () => {
  const rels = collectRelations(join(import.meta.dirname, '../../../db/migrations'));
  const listed = Object.keys(TABLE_PERMISSIONS);
  const hasUserId = (table: string): boolean => rels.get(table)?.hasUserId ?? false;
  const filterFor = (table: string): string => (hasUserId(table) ? ' WHERE user_id = 1' : ' WHERE id = 1');

  /** UPDATE 대상 컬럼: 컬럼 제한이 있으면 첫 허용 컬럼, 없으면 임의 컬럼 */
  const columnFor = (table: string): string => {
    const entry = getTableAccess(table);
    return entry.access === 'write' && Array.isArray(entry.update) ? (entry.update[0] ?? 'x') : 'title';
  };

  const modifySql = (table: string, op: ModifyOp): string => {
    if (op === 'insert') {
      return hasUserId(table)
        ? `INSERT INTO ${table} (user_id, title) VALUES (1, 'x')`
        : `INSERT INTO ${table} (title) VALUES ('x')`;
    }
    if (op === 'update') return `UPDATE ${table} SET ${columnFor(table)} = 'x'${filterFor(table)}`;
    return `DELETE FROM ${table}${filterFor(table)}`;
  };

  const ops: ModifyOp[] = ['insert', 'update', 'delete'];
  const cases = listed.flatMap((table) => ops.map((op) => [table, op] as const));

  it('마이그레이션의 모든 테이블·뷰와 schema_migrations가 목록에 있다', () => {
    const missing = [...rels.keys(), 'schema_migrations'].filter((t) => !listed.includes(t));
    expect(missing).toEqual([]);
  });

  it('목록의 테이블은 모두 마이그레이션에 있다', () => {
    const stale = listed.filter((t) => t !== 'schema_migrations' && !rels.has(t));
    expect(stale).toEqual([]);
  });

  it('읽고 쓰기 묶음은 10개다', () => {
    const writable = listed.filter((t) => getTableAccess(t).access === 'write').sort();
    expect(writable).toEqual([
      'categories',
      'custom_instructions',
      'notification_settings',
      'reminders',
      'routine_records',
      'routine_templates',
      'schedule_changes',
      'schedules',
      'sleep_events',
      'sleep_records',
    ]);
  });

  it.each(cases)('%s %s: 권한 목록이 허용하면 SQL 검사도 허용하고, 아니면 거절한다', (table, op) => {
    const error = checkModify(modifySql(table, op));
    if (isToolModifyAllowed(table, op, [columnFor(table)])) expect(error).toBeNull();
    else expect(error).not.toBeNull();
  });

  it.each(listed.filter((t) => getTableAccess(t).access !== 'none'))(
    '%s: 조회 권한을 준 테이블은 SQL 검사가 조회를 허용한다',
    (table) => {
      const where = hasUserId(table) ? ' WHERE user_id = 1' : '';
      expect(checkQuery(`SELECT * FROM ${table}${where}`)).toBeNull();
    },
  );

  it('SQL 검사가 조회를 거절하는 테이블은 권한 없음이다', () => {
    for (const table of BLOCKED_TABLES) expect(getTableAccess(table).access).toBe('none');
  });

  it('목록에 없는 테이블은 권한 없음이고 변경 대상으로 거절한다', () => {
    expect(getTableAccess('not_listed_table').access).toBe('none');
    expect(getTableAccess('constructor').access).toBe('none');
    expect(checkModify('DELETE FROM not_listed_table WHERE user_id = 1')).not.toBeNull();
  });

  it('일정 변경 이력은 삭제 사유 컬럼만 바꿀 수 있고 직접 INSERT·DELETE는 거절한다', () => {
    const ok =
      "UPDATE schedule_changes SET delete_reason_category = 'plan', delete_reason_text = 'x' " +
      'WHERE user_id = 1 AND id = 3';
    expect(checkModify(ok)).toBeNull();
    expect(checkModify("UPDATE schedule_changes SET old_date = '2026-01-01' WHERE user_id = 1")).toMatch(
      /delete_reason_category, delete_reason_text 컬럼만/,
    );
    expect(checkModify("INSERT INTO schedule_changes (user_id, kind) VALUES (1, 'x')")).toMatch(/INSERT할 수 없어/);
    expect(checkModify('DELETE FROM schedule_changes WHERE user_id = 1')).toMatch(/DELETE할 수 없어/);
  });

  it('알림 설정은 시간 변경만 허용하고 추가·삭제는 거절한다', () => {
    expect(checkModify("UPDATE notification_settings SET time_value = '09:00' WHERE id = 1")).toBeNull();
    expect(checkModify('UPDATE notification_settings SET active = false WHERE id = 1')).toMatch(
      /time_value 컬럼만/,
    );
    expect(
      checkModify("UPDATE notification_settings SET time_value = '09:00', label = 'x' WHERE id = 1"),
    ).toMatch(/time_value 컬럼만/);
    expect(checkModify("INSERT INTO notification_settings (slot_name) VALUES ('x')")).toMatch(/INSERT할 수 없어/);
    expect(checkModify('DELETE FROM notification_settings WHERE id = 1')).toMatch(/DELETE할 수 없어/);
  });

  it('읽기만 하는 사용자 테이블과 권한 없음 테이블은 변경 대상으로 거절한다', () => {
    expect(checkModify('DELETE FROM expenses WHERE user_id = 1')).toMatch(READ_ONLY);
    expect(checkModify("UPDATE pending_modify SET sql_text = 'x' WHERE user_id = 1")).toMatch(
      /pending_modify 테이블은 쓸 수 없어/,
    );
  });

  it('ON CONFLICT DO UPDATE는 대상 테이블의 INSERT 권한도 본다', () => {
    expect(
      checkModify(
        "INSERT INTO schedule_changes (user_id) VALUES (1) ON CONFLICT (user_id) DO UPDATE SET delete_reason_text = 'x'",
      ),
    ).toMatch(/INSERT할 수 없어/);
  });
});
