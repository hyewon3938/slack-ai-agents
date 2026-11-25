/**
 * SQL 도구 역할의 권한 동기화 (ADR-0067).
 *
 * 봇 시작 시 마이그레이션 뒤에 돈다. 한 트랜잭션 안에서 public 스키마의 테이블·시퀀스·함수에 걸린
 * 도구 역할의 권한을 모두 거둔 뒤 table-permissions.ts 목록대로 다시 준다. 몇 번을 실행해도 결과가 같고,
 * 권한 정보 없이 백업을 복원한 뒤에도 봇을 다시 시작하면 권한이 돌아온다.
 */

import type pg from 'pg';
import { withTransaction } from '../db.js';
import { TABLE_PERMISSIONS, getTableAccess } from './table-permissions.js';

/** PostgreSQL 식별자 인용: 큰따옴표로 감싸고 안의 큰따옴표는 두 번 쓴다 */
export const quoteIdent = (name: string): string => `"${name.replaceAll('"', '""')}"`;

/** 연결 문자열의 사용자 이름 (없거나 해석할 수 없으면 null) */
export const roleFromUrl = (url: string): string | null => {
  try {
    const name = decodeURIComponent(new URL(url).username);
    return name === '' ? null : name;
  } catch {
    return null;
  }
};

export interface SequenceOwner {
  table: string;
  sequence: string;
}

export interface PrivilegePlanInput {
  role: string;
  /** DB에 실제로 있는 public 테이블·뷰 이름 */
  tables: readonly string[];
  /** public 시퀀스와 그 시퀀스를 쓰는 테이블 (serial·identity 컬럼) */
  sequences: readonly SequenceOwner[];
}

const tableGrants = (table: string, role: string): string[] => {
  const entry = getTableAccess(table);
  const target = `${quoteIdent(table)} TO ${role}`;
  if (entry.access === 'none') return [];
  if (entry.access === 'read') return [`GRANT SELECT ON TABLE ${target}`];
  const privileges = ['SELECT'];
  if (entry.insert) privileges.push('INSERT');
  if (entry.update === true) privileges.push('UPDATE');
  if (entry.delete) privileges.push('DELETE');
  const statements = [`GRANT ${privileges.join(', ')} ON TABLE ${target}`];
  if (Array.isArray(entry.update) && entry.update.length > 0) {
    const columns = entry.update.map(quoteIdent).join(', ');
    statements.push(`GRANT UPDATE (${columns}) ON TABLE ${target}`);
  }
  return statements;
};

/**
 * 권한 목록에서 REVOKE·GRANT 문을 만든다 (DB 없이 검증하는 순수 함수).
 * 시퀀스는 INSERT 권한을 준 테이블의 것에만 USAGE를 준다.
 */
export const buildPrivilegeStatements = ({ role, tables, sequences }: PrivilegePlanInput): string[] => {
  const r = quoteIdent(role);
  const existing = [...new Set(tables)].sort();
  const insertTables = new Set(
    existing.filter((t) => {
      const entry = getTableAccess(t);
      return entry.access === 'write' && entry.insert;
    }),
  );
  const usage = [
    ...new Set(sequences.filter((s) => insertTables.has(s.table)).map((s) => s.sequence)),
  ].sort();
  return [
    `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${r}`,
    `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${r}`,
    `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM ${r}`,
    'REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC',
    ...existing.flatMap((t) => tableGrants(t, r)),
    ...usage.map((s) => `GRANT USAGE ON SEQUENCE ${quoteIdent(s)} TO ${r}`),
  ];
};

interface RoleRow {
  is_current: boolean;
  privileged: boolean;
  owns_objects: boolean;
}

/** 동기화를 해도 되는 역할인지. 안 되면 건너뛸 이유를 돌려준다 */
const checkRole = async (client: pg.PoolClient, role: string): Promise<string | null> => {
  const { rows } = await client.query<RoleRow>(
    `SELECT r.rolname = current_user AS is_current,
            (r.rolsuper OR r.rolbypassrls) AS privileged,
            EXISTS (
              SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relowner = r.oid
            ) AS owns_objects
       FROM pg_roles r WHERE r.rolname = $1`,
    [role],
  );
  const row = rows[0];
  if (!row) return '역할이 DB에 없어 건너뜀';
  if (row.is_current) return '앱 역할과 같은 역할이라 건너뜀';
  if (row.privileged) return '슈퍼유저·RLS 우회 속성이 있는 역할이라 건너뜀';
  if (row.owns_objects) return 'public 테이블을 소유한 역할이라 건너뜀';
  return null;
};

const loadTables = async (client: pg.PoolClient): Promise<string[]> => {
  const { rows } = await client.query<{ name: string }>(
    `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')`,
  );
  return rows.map((r) => r.name);
};

const loadSequences = async (client: pg.PoolClient): Promise<SequenceOwner[]> => {
  const { rows } = await client.query<SequenceOwner>(
    `SELECT t.relname AS table, s.relname AS sequence
       FROM pg_class s
       JOIN pg_namespace n ON n.oid = s.relnamespace
       JOIN pg_depend d ON d.objid = s.oid
        AND d.classid = 'pg_class'::regclass AND d.refclassid = 'pg_class'::regclass
        AND d.deptype IN ('a', 'i')
       JOIN pg_class t ON t.oid = d.refobjid
      WHERE s.relkind = 'S' AND n.nspname = 'public'`,
  );
  return rows;
};

const warnListDrift = (tables: readonly string[]): void => {
  const existing = new Set(tables);
  const missing = Object.keys(TABLE_PERMISSIONS).filter(
    (t) => t !== 'schema_migrations' && !existing.has(t),
  );
  const unlisted = tables.filter((t) => !Object.hasOwn(TABLE_PERMISSIONS, t));
  if (missing.length > 0) console.warn(`[SQL 권한] 목록에 있지만 DB에 없는 테이블: ${missing.join(', ')}`);
  if (unlisted.length > 0) {
    console.warn(`[SQL 권한] 목록에 없어 권한을 주지 않은 테이블: ${unlisted.join(', ')}`);
  }
};

/**
 * SQL 도구 역할의 권한을 목록대로 맞춘다. 앱 역할(기존 풀)로 실행한다.
 * 연결 문자열이 없거나 역할을 쓸 수 없으면 경고를 남기고 건너뛴다.
 */
export const syncSqlToolPrivileges = async (sqlToolUrl: string): Promise<boolean> => {
  if (sqlToolUrl === '') return false;
  const role = roleFromUrl(sqlToolUrl);
  if (!role) {
    console.warn('[SQL 권한] 도구 연결 문자열에서 역할 이름을 읽지 못해 동기화를 건너뜀');
    return false;
  }
  return withTransaction(async (client) => {
    const skip = await checkRole(client, role);
    if (skip) {
      console.warn(`[SQL 권한] ${skip}`);
      return false;
    }
    const tables = await loadTables(client);
    warnListDrift(tables);
    const statements = buildPrivilegeStatements({
      role,
      tables,
      sequences: await loadSequences(client),
    });
    for (const sql of statements) await client.query(sql);
    console.log(`[SQL 권한] 도구 역할 권한 동기화 완료 (${statements.length}개 문)`);
    return true;
  });
};
