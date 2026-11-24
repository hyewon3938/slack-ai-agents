import { describe, expect, it } from 'vitest';
import {
  applyMigration,
  createSchema,
  parseColumnDef,
  type SchemaState,
} from '../sql-migrations.js';
import { maskLiterals, splitStatements } from '../sql-split.js';
import { findSqlTableRefs, findTableUsage } from '../table-usage.js';

const run = (...sqls: string[]): SchemaState => {
  const state = createSchema();
  sqls.forEach((sql, i) => applyMigration(state, `00${i + 1}.sql`, sql));
  return state;
};

const columns = (state: SchemaState, table: string): string[] =>
  (state.tables.get(table)?.columns ?? []).map((c) => c.name);

describe('splitStatements', () => {
  it('주석과 인용 안의 세미콜론에서는 나누지 않는다', () => {
    const sql = "-- a; b\nSELECT ';' AS x; /* c; */ DO $$ BEGIN x; END $$; SELECT $t$;$t$";
    expect(splitStatements(sql)).toEqual([
      "SELECT ';' AS x",
      'DO $$ BEGIN x; END $$',
      'SELECT $t$;$t$',
    ]);
  });

  it('문자열을 자리표로 바꾼다', () => {
    const { masked, literals } = maskLiterals("DEFAULT 'it''s' CHECK (a IN ('x'))");
    expect(masked).toBe("DEFAULT '0' CHECK (a IN ('1'))");
    expect(literals.map((l) => l.content)).toEqual(["it's", 'x']);
  });
});

describe('parseColumnDef', () => {
  it('타입, NOT NULL, 기본값, PK를 읽는다', () => {
    expect(parseColumnDef('amount NUMERIC(10, 2) NOT NULL DEFAULT 0')).toEqual({
      name: 'amount',
      type: 'NUMERIC(10, 2)',
      notNull: true,
      defaultValue: '0',
      primaryKey: false,
    });
    expect(parseColumnDef('id SERIAL PRIMARY KEY')).toMatchObject({
      type: 'SERIAL',
      notNull: true,
      primaryKey: true,
    });
    expect(
      parseColumnDef('at TIMESTAMP WITH TIME ZONE DEFAULT now() REFERENCES t(id)'),
    ).toMatchObject({
      type: 'TIMESTAMP WITH TIME ZONE',
      defaultValue: 'now()',
      notNull: false,
    });
  });
});

describe('applyMigration', () => {
  it('CREATE TABLE의 컬럼과 표 수준 PK를 읽는다', () => {
    const state = run(
      "CREATE TABLE IF NOT EXISTS t (a INT, b TEXT NOT NULL DEFAULT 'x;y', CONSTRAINT t_pk PRIMARY KEY (a, b), CHECK (a > 0));",
    );
    const table = state.tables.get('t');
    expect(table?.columns.map((c) => [c.name, c.primaryKey])).toEqual([
      ['a', true],
      ['b', true],
    ]);
    expect(table?.columns[1]?.defaultValue).toBe("'x;y'");
    expect(state.unparsed).toEqual([]);
  });

  it('IF NOT EXISTS로 다시 만든 테이블은 그대로 둔다', () => {
    const state = run('CREATE TABLE t (a INT);', 'CREATE TABLE IF NOT EXISTS t (z INT);');
    expect(columns(state, 't')).toEqual(['a']);
  });

  it('ALTER TABLE의 여러 동작을 순서대로 적용한다', () => {
    const state = run(
      'CREATE TABLE t (a INT, b TEXT, c TEXT);',
      [
        'ALTER TABLE t ADD COLUMN IF NOT EXISTS d NUMERIC(5, 2) DEFAULT 0, DROP COLUMN b, ADD CONSTRAINT ck CHECK (a IN (1, 2));',
        'ALTER TABLE t RENAME COLUMN c TO c2;',
        'ALTER TABLE t ALTER COLUMN a SET NOT NULL, ALTER COLUMN a TYPE BIGINT USING a::bigint;',
        "ALTER TABLE t ALTER COLUMN c2 SET DEFAULT 'n';",
      ].join('\n'),
    );
    expect(columns(state, 't')).toEqual(['a', 'c2', 'd']);
    expect(state.tables.get('t')?.columns[0]).toMatchObject({ type: 'BIGINT', notNull: true });
    expect(state.tables.get('t')?.columns[1]?.defaultValue).toBe("'n'");
    expect(state.tables.get('t')?.changedIn).toEqual(['002.sql']);
    expect(state.unparsed).toEqual([]);
  });

  it('테이블 이름 변경과 삭제를 따라간다', () => {
    const state = run(
      'CREATE TABLE a (x INT); CREATE TABLE b (y INT);',
      'ALTER TABLE a RENAME TO c; DROP TABLE IF EXISTS b, nope CASCADE;',
    );
    expect([...state.tables.keys()]).toEqual(['c']);
    expect(state.tables.get('c')?.name).toBe('c');
  });

  it('DO 블록과 EXECUTE 문자열 안의 DDL을 적용한다', () => {
    const state = run(
      'CREATE TABLE t (a INT); CREATE TABLE old (a INT);',
      [
        'DO $$ BEGIN',
        "  IF NOT EXISTS (SELECT 1 FROM x WHERE n = 'ALTER TABLE t DROP COLUMN a') THEN",
        '    ALTER TABLE t ADD COLUMN b TEXT;',
        '  END IF;',
        "  EXECUTE 'DROP TABLE old';",
        "  EXECUTE format('ALTER TABLE t DROP CONSTRAINT %I', cname);",
        "  EXECUTE 'SELECT count(*) FROM t' INTO cnt;",
        'END $$;',
      ].join('\n'),
    );
    expect(columns(state, 't')).toEqual(['a', 'b']);
    expect(state.tables.has('old')).toBe(false);
    expect(state.unparsed).toEqual([]);
  });

  it('뷰는 이름만 기록하고 임시 테이블과 무관한 문장은 넘긴다', () => {
    const state = run(
      "CREATE OR REPLACE VIEW v AS SELECT 1; CREATE TEMP TABLE tmp AS SELECT 1; INSERT INTO x VALUES ('CREATE TABLE y (a INT)'); CREATE INDEX i ON x (a);",
    );
    expect([...state.views.keys()]).toEqual(['v']);
    expect(state.tables.size).toBe(0);
    expect(state.unparsed).toEqual([]);
  });

  it('해석하지 못한 문장은 세어 둔다', () => {
    const state = run(
      'CREATE TABLE t AS SELECT 1; ALTER TABLE missing ADD COLUMN a INT; MERGE INTO t USING s ON true; DO $$ BEGIN EXECUTE build_sql(); END $$;',
    );
    expect(state.unparsed.map((u) => u.head.slice(0, 12))).toEqual([
      'CREATE TABLE',
      'ALTER TABLE ',
      'MERGE INTO t',
      'BEGIN EXECUT',
    ]);
    expect(state.tables.size).toBe(0);
  });
});

describe('findTableUsage', () => {
  const known = new Set(['schedules', 'routines']);

  it('SQL 키워드 바로 뒤의 테이블 이름만 찾는다', () => {
    expect(findSqlTableRefs('SELECT * FROM schedules s JOIN routines r ON true', known)).toEqual([
      'routines',
      'schedules',
    ]);
    expect(findSqlTableRefs('schedules 화면으로 이동', known)).toEqual([]);
    expect(findSqlTableRefs('SELECT * FROM schedules_archive', known)).toEqual([]);
  });

  it('템플릿 문자열은 읽고 import 경로는 건너뛴다', () => {
    const src =
      "import { x } from './routines';\nconst q = `UPDATE schedules SET a = ${v} WHERE id = 1`;";
    expect(findTableUsage('x.ts', src, known)).toEqual(['schedules']);
  });
});
