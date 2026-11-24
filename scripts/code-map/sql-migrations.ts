/**
 * 마이그레이션 SQL을 순서대로 적용해 현재 테이블과 컬럼을 계산한다.
 * 해석하지 못한 문장은 버리지 않고 unparsed에 모은다.
 */
import {
  maskLiterals,
  normalizeIdent,
  readParenGroup,
  splitStatements,
  splitTopLevel,
  type SqlLiteral,
} from './sql-split.js';

export interface ColumnInfo {
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: string | null;
  primaryKey: boolean;
}

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  createdIn: string;
  changedIn: string[];
}

export interface UnparsedStatement {
  file: string;
  head: string;
}

export interface SchemaState {
  tables: Map<string, TableInfo>;
  /** 뷰 이름 → 마지막으로 정의한 마이그레이션 파일 */
  views: Map<string, string>;
  unparsed: UnparsedStatement[];
}

class UnparsedError extends Error {}

const fail = (reason: string): never => {
  throw new UnparsedError(reason);
};

export const createSchema = (): SchemaState => ({
  tables: new Map(),
  views: new Map(),
  unparsed: [],
});

const COLUMN_STOP =
  /^(NOT|NULL|DEFAULT|PRIMARY|REFERENCES|UNIQUE|CHECK|CONSTRAINT|GENERATED|COLLATE)$/i;
const TABLE_CONSTRAINT = /^(CONSTRAINT|PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY|EXCLUDE)\b/i;
const IGNORED_STATEMENT =
  /^(INSERT|UPDATE|DELETE|SELECT|WITH|SET|RESET|BEGIN|COMMIT|ROLLBACK|START|COMMENT|GRANT|REVOKE|TRUNCATE|ANALYZE|VACUUM|LOCK|CREATE\s+(UNIQUE\s+)?INDEX|DROP\s+INDEX|ALTER\s+INDEX|CREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|PROCEDURE|TRIGGER)|CREATE\s+CONSTRAINT\s+TRIGGER|DROP\s+(FUNCTION|PROCEDURE|TRIGGER)|CREATE\s+EXTENSION|CREATE\s+TYPE|DROP\s+TYPE|ALTER\s+TYPE|CREATE\s+SEQUENCE|ALTER\s+SEQUENCE|DROP\s+SEQUENCE)\b/i;
const IGNORED_ALTER_ACTION =
  /^(ADD\s+CONSTRAINT|ADD\s+(UNIQUE|CHECK|FOREIGN|EXCLUDE)|DROP\s+CONSTRAINT|RENAME\s+CONSTRAINT|VALIDATE\s+CONSTRAINT|ALTER\s+CONSTRAINT|ENABLE|DISABLE|OWNER\s+TO|SET\s*\(|RESET\s*\(|CLUSTER|REPLICA|FORCE|NO\s+FORCE)\b/i;
const EMBEDDED_DDL =
  /\b(CREATE\s+(?:(?:TEMP|TEMPORARY|UNLOGGED)\s+)?TABLE|ALTER\s+TABLE|DROP\s+TABLE|CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW|DROP\s+(?:MATERIALIZED\s+)?VIEW)\b/i;

const restore = (masked: string, literals: SqlLiteral[]): string =>
  masked.replace(/'(\d+)'/g, (_m, idx: string) => {
    const lit = literals[Number(idx)];
    if (!lit) return "''";
    return lit.dollar ? `$$${lit.content}$$` : `'${lit.content.replace(/'/g, "''")}'`;
  });

const ident = (raw: string): string => {
  const name = normalizeIdent(raw);
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) fail(`식별자 해석 불가: ${raw}`);
  return name;
};

const squeeze = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** 컬럼 정의 한 개를 읽는다. 예: `amount NUMERIC(10, 2) NOT NULL DEFAULT 0` */
export const parseColumnDef = (def: string, literals: SqlLiteral[] = []): ColumnInfo => {
  const tokens = splitTopLevel(def, ' ');
  const name = ident(tokens[0] ?? '');
  let i = 1;
  const typeTokens: string[] = [];
  while (i < tokens.length && !COLUMN_STOP.test(tokens[i] ?? ''))
    typeTokens.push(tokens[i++] ?? '');
  if (typeTokens.length === 0) fail(`타입 없음: ${def}`);
  const type = squeeze(restore(typeTokens.join(' '), literals));
  const col: ColumnInfo = {
    name,
    type,
    notNull: /^(SMALL|BIG)?SERIAL\b/i.test(type),
    defaultValue: null,
    primaryKey: false,
  };
  for (; i < tokens.length; i += 1) {
    const tok = (tokens[i] ?? '').toUpperCase();
    const next = (tokens[i + 1] ?? '').toUpperCase();
    if (tok === 'NOT' && next === 'NULL') col.notNull = true;
    if (tok === 'PRIMARY' && next === 'KEY') {
      col.primaryKey = true;
      col.notNull = true;
    }
    if (tok === 'DEFAULT') {
      const expr: string[] = [];
      while (i + 1 < tokens.length && !COLUMN_STOP.test(tokens[i + 1] ?? ''))
        expr.push(tokens[++i] ?? '');
      col.defaultValue = squeeze(restore(expr.join(' '), literals));
    }
  }
  return col;
};

const setPrimaryKey = (table: TableInfo, columnList: string): void => {
  const names = splitTopLevel(columnList, ',').map(ident);
  for (const col of table.columns) {
    col.primaryKey = names.includes(col.name);
    if (col.primaryKey) col.notNull = true;
  }
};

const primaryKeyColumns = (item: string): string | null => {
  const m = /^(?:CONSTRAINT\s+\S+\s+)?PRIMARY\s+KEY\s*/i.exec(item);
  if (!m) return null;
  return readParenGroup(item.slice(m[0].length))?.inner ?? fail(`PK 해석 불가: ${item}`);
};

const touch = (table: TableInfo, file: string): void => {
  if (table.createdIn !== file && !table.changedIn.includes(file)) table.changedIn.push(file);
};

const requireTable = (state: SchemaState, name: string): TableInfo =>
  state.tables.get(name) ?? fail(`없는 테이블: ${name}`);

const requireColumn = (table: TableInfo, name: string): ColumnInfo =>
  table.columns.find((c) => c.name === name) ?? fail(`없는 컬럼: ${table.name}.${name}`);

const applyCreateTable = (
  state: SchemaState,
  file: string,
  masked: string,
  literals: SqlLiteral[],
): void => {
  const m = /^CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?("[^"]+"|[\w.]+)\s*/i.exec(masked);
  if (!m) return fail('CREATE TABLE 머리 해석 불가');
  const name = ident(m[2] ?? '');
  const after = masked.slice(m[0].length);
  if (!after.startsWith('(')) return fail('컬럼 목록 없는 CREATE TABLE');
  const group = readParenGroup(after) ?? fail('괄호 짝 불일치');
  if (state.tables.has(name)) {
    if (m[1]) return;
    return fail(`이미 있는 테이블: ${name}`);
  }
  const table: TableInfo = { name, columns: [], createdIn: file, changedIn: [] };
  const pkLists: string[] = [];
  for (const item of splitTopLevel(group.inner, ',')) {
    if (/^LIKE\b/i.test(item)) return fail('LIKE 절');
    const pk = primaryKeyColumns(item);
    if (pk !== null) pkLists.push(pk);
    else if (!TABLE_CONSTRAINT.test(item)) table.columns.push(parseColumnDef(item, literals));
  }
  for (const pk of pkLists) setPrimaryKey(table, pk);
  state.tables.set(name, table);
};

const alterColumn = (table: TableInfo, body: string, literals: SqlLiteral[]): void => {
  const m = /^("[^"]+"|\w+)\s+([\s\S]+)$/.exec(body);
  if (!m) return fail(`ALTER COLUMN 해석 불가: ${body}`);
  const col = requireColumn(table, ident(m[1] ?? ''));
  const rest = m[2] ?? '';
  const typeMatch = /^(?:SET\s+DATA\s+)?TYPE\s+([\s\S]+?)(?:\s+USING\b[\s\S]*)?$/i.exec(rest);
  if (typeMatch) col.type = squeeze(restore(typeMatch[1] ?? '', literals));
  else if (/^SET\s+NOT\s+NULL$/i.test(rest)) col.notNull = true;
  else if (/^DROP\s+NOT\s+NULL$/i.test(rest)) col.notNull = false;
  else if (/^DROP\s+DEFAULT$/i.test(rest)) col.defaultValue = null;
  else if (/^SET\s+DEFAULT\s+/i.test(rest)) {
    col.defaultValue = squeeze(restore(rest.replace(/^SET\s+DEFAULT\s+/i, ''), literals));
  } else if (
    !/^(SET|RESET)\s+(STATISTICS|STORAGE|\()|^(ADD|DROP)\s+(GENERATED|IDENTITY)/i.test(rest)
  ) {
    fail(`ALTER COLUMN 동작 해석 불가: ${rest}`);
  }
};

const applyAlterAction = (
  state: SchemaState,
  table: TableInfo,
  action: string,
  literals: SqlLiteral[],
): void => {
  const pk = /^ADD\s+/i.test(action) ? primaryKeyColumns(action.replace(/^ADD\s+/i, '')) : null;
  if (pk !== null) return setPrimaryKey(table, pk);
  const dropConstraint = /^DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?("[^"]+"|\S+)/i.exec(action);
  if (dropConstraint && /_pkey"?$/i.test(dropConstraint[1] ?? '')) {
    for (const col of table.columns) col.primaryKey = false;
    return;
  }
  if (IGNORED_ALTER_ACTION.test(action)) return;
  const add = /^ADD\s+(?:COLUMN\s+)?(IF\s+NOT\s+EXISTS\s+)?([\s\S]+)$/i.exec(action);
  if (add) {
    const col = parseColumnDef(add[2] ?? '', literals);
    const exists = table.columns.some((c) => c.name === col.name);
    if (exists && !add[1]) return fail(`이미 있는 컬럼: ${table.name}.${col.name}`);
    if (!exists) table.columns.push(col);
    return;
  }
  const drop =
    /^DROP\s+(?:COLUMN\s+)?(IF\s+EXISTS\s+)?("[^"]+"|\w+)(?:\s+(?:CASCADE|RESTRICT))?$/i.exec(
      action,
    );
  if (drop) {
    const name = ident(drop[2] ?? '');
    if (!drop[1]) requireColumn(table, name);
    table.columns = table.columns.filter((c) => c.name !== name);
    return;
  }
  const renameCol = /^RENAME\s+(?:COLUMN\s+)?("[^"]+"|\w+)\s+TO\s+("[^"]+"|\w+)$/i.exec(action);
  if (renameCol) {
    requireColumn(table, ident(renameCol[1] ?? '')).name = ident(renameCol[2] ?? '');
    return;
  }
  const renameTable = /^RENAME\s+TO\s+("[^"]+"|\w+)$/i.exec(action);
  if (renameTable) {
    state.tables.delete(table.name);
    table.name = ident(renameTable[1] ?? '');
    state.tables.set(table.name, table);
    return;
  }
  const alter = /^ALTER\s+(?:COLUMN\s+)?([\s\S]+)$/i.exec(action);
  if (alter) return alterColumn(table, alter[1] ?? '', literals);
  fail(`ALTER TABLE 동작 해석 불가: ${action}`);
};

const applyAlterTable = (
  state: SchemaState,
  file: string,
  masked: string,
  literals: SqlLiteral[],
): void => {
  const m = /^ALTER\s+TABLE\s+(IF\s+EXISTS\s+)?(?:ONLY\s+)?("[^"]+"|[\w.]+)\s+([\s\S]+)$/i.exec(
    masked,
  );
  if (!m) return fail('ALTER TABLE 머리 해석 불가');
  const name = ident(m[2] ?? '');
  if (!state.tables.has(name) && m[1]) return;
  const table = requireTable(state, name);
  for (const action of splitTopLevel(m[3] ?? '', ','))
    applyAlterAction(state, table, action, literals);
  touch(table, file);
};

const applyDrop = (target: Map<string, unknown>, masked: string, keyword: RegExp): void => {
  const m = keyword.exec(masked);
  if (!m) return fail('DROP 머리 해석 불가');
  const ifExists = /^IF\s+EXISTS\s+/i.test(masked.slice(m[0].length));
  const list = masked
    .slice(m[0].length)
    .replace(/^IF\s+EXISTS\s+/i, '')
    .replace(/\s+(CASCADE|RESTRICT)\s*$/i, '');
  for (const raw of splitTopLevel(list, ',')) {
    const name = ident(raw);
    if (!target.has(name) && !ifExists) fail(`없는 대상 DROP: ${name}`);
    target.delete(name);
  }
};

const applyCreateView = (state: SchemaState, file: string, masked: string): void => {
  const m =
    /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?("[^"]+"|[\w.]+)/i.exec(
      masked,
    );
  if (!m) return fail('CREATE VIEW 머리 해석 불가');
  state.views.set(ident(m[1] ?? ''), file);
};

/** EXECUTE 뒤의 SQL 문자열을 꺼낸다. 문자열이 고정이 아니면 해석 불가로 본다. */
const executeTarget = (afterExecute: string, literals: SqlLiteral[]): string => {
  const plain = /^'(\d+)'(?:\s+(?:INTO|USING)\b[\s\S]*)?$/i.exec(afterExecute);
  const formatted = /^format\s*\(\s*'(\d+)'/i.exec(afterExecute);
  const idx = plain?.[1] ?? formatted?.[1];
  const lit = idx === undefined ? undefined : literals[Number(idx)];
  return lit?.content ?? fail('동적 EXECUTE');
};

const applyStatement = (
  state: SchemaState,
  file: string,
  stmt: string,
  embedded: boolean,
): void => {
  const { masked: rawMasked, literals } = maskLiterals(stmt);
  let masked = squeeze(rawMasked);
  if (embedded) {
    const exec = /\bEXECUTE\s+(?!FUNCTION\b|PROCEDURE\b)/i.exec(masked);
    if (exec) {
      const sql = executeTarget(masked.slice(exec.index + exec[0].length), literals);
      return applySql(state, file, sql, true);
    }
    const ddl = EMBEDDED_DDL.exec(masked);
    if (!ddl) return;
    masked = masked.slice(ddl.index);
  }
  if (/^DO\b/i.test(masked)) {
    const body = literals.find((l) => l.dollar) ?? literals[0];
    return applySql(state, file, body?.content ?? fail('DO 본문 없음'), true);
  }
  if (/^CREATE\s+(TEMP|TEMPORARY)\s+TABLE\b/i.test(masked)) return;
  if (/^CREATE\s+(UNLOGGED\s+)?TABLE\b/i.test(masked)) {
    return applyCreateTable(
      state,
      file,
      masked.replace(/^CREATE\s+UNLOGGED\s+/i, 'CREATE '),
      literals,
    );
  }
  if (/^ALTER\s+TABLE\b/i.test(masked)) return applyAlterTable(state, file, masked, literals);
  if (/^DROP\s+TABLE\b/i.test(masked)) return applyDrop(state.tables, masked, /^DROP\s+TABLE\s+/i);
  if (/^DROP\s+(MATERIALIZED\s+)?VIEW\b/i.test(masked)) {
    return applyDrop(state.views, masked, /^DROP\s+(MATERIALIZED\s+)?VIEW\s+/i);
  }
  if (/^CREATE\s+(OR\s+REPLACE\s+)?(MATERIALIZED\s+)?VIEW\b/i.test(masked)) {
    return applyCreateView(state, file, masked);
  }
  if (!embedded && !IGNORED_STATEMENT.test(masked)) fail('알 수 없는 문장');
};

const applySql = (state: SchemaState, file: string, sql: string, embedded: boolean): void => {
  for (const stmt of splitStatements(sql)) {
    try {
      applyStatement(state, file, stmt, embedded);
    } catch (err: unknown) {
      if (!(err instanceof UnparsedError)) throw err;
      state.unparsed.push({ file, head: squeeze(stmt).slice(0, 70) });
    }
  }
};

/** 마이그레이션 파일 하나를 상태에 적용한다. 파일은 실행 순서대로 넘겨야 한다. */
export const applyMigration = (state: SchemaState, file: string, sql: string): void =>
  applySql(state, file, sql, false);
