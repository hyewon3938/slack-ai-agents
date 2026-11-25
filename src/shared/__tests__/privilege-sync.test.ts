import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { setSqlToolPoolRequired } from '../db.js';
import {
  buildPrivilegeStatements,
  quoteIdent,
  roleFromUrl,
  startSqlToolPool,
} from '../sql-tools/privilege-sync.js';
import { TABLE_PERMISSIONS } from '../sql-tools/table-permissions.js';

const ALL_TABLES = Object.keys(TABLE_PERMISSIONS).filter((t) => t !== 'schema_migrations');

const build = (overrides: Partial<Parameters<typeof buildPrivilegeStatements>[0]> = {}): string[] =>
  buildPrivilegeStatements({
    role: 'sql_tool',
    tables: ALL_TABLES,
    sequences: [
      { table: 'schedules', sequence: 'schedules_id_seq' },
      { table: 'schedule_changes', sequence: 'schedule_changes_id_seq' },
      { table: 'notification_settings', sequence: 'notification_settings_id_seq' },
      { table: 'expenses', sequence: 'expenses_id_seq' },
      { table: 'pending_modify', sequence: 'pending_modify_id_seq' },
    ],
    ...overrides,
  });

describe('quoteIdent', () => {
  it('큰따옴표로 감싸고 안의 큰따옴표는 두 번 쓴다', () => {
    expect(quoteIdent('sql_tool')).toBe('"sql_tool"');
    expect(quoteIdent('a"b')).toBe('"a""b"');
    expect(quoteIdent('x"; DROP TABLE users; --')).toBe('"x""; DROP TABLE users; --"');
  });
});

describe('roleFromUrl', () => {
  it('연결 문자열의 사용자 이름을 읽는다', () => {
    expect(roleFromUrl('postgresql://sql_tool:pw@localhost:5432/app')).toBe('sql_tool');
    expect(roleFromUrl('postgresql://tool%2Drole:pw@localhost/app')).toBe('tool-role');
  });

  it('사용자 이름이 없거나 해석할 수 없으면 null', () => {
    expect(roleFromUrl('postgresql://localhost/app')).toBeNull();
    expect(roleFromUrl('not a url')).toBeNull();
    expect(roleFromUrl('')).toBeNull();
  });
});

describe('buildPrivilegeStatements', () => {
  it('먼저 테이블·시퀀스·함수 권한을 모두 거두고 PUBLIC 함수 실행 권한도 거둔다', () => {
    expect(build().slice(0, 4)).toEqual([
      'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "sql_tool"',
      'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM "sql_tool"',
      'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM "sql_tool"',
      'REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC',
    ]);
  });

  it('읽고 쓰기 테이블은 네 권한, 읽기 테이블은 SELECT만 준다', () => {
    const s = build();
    expect(s).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "schedules" TO "sql_tool"');
    expect(s).toContain('GRANT SELECT ON TABLE "expenses" TO "sql_tool"');
    expect(s).toContain('GRANT SELECT ON TABLE "ganji_master" TO "sql_tool"');
  });

  it('알림 설정은 SELECT와 시간 컬럼 UPDATE만, 변경 이력은 SELECT·INSERT와 삭제 사유 컬럼 UPDATE만 준다', () => {
    const s = build();
    expect(s).toContain('GRANT SELECT ON TABLE "notification_settings" TO "sql_tool"');
    expect(s).toContain('GRANT UPDATE ("time_value") ON TABLE "notification_settings" TO "sql_tool"');
    expect(s.some((sql) => sql.includes('UPDATE ON TABLE "notification_settings"'))).toBe(false);
    expect(s).toContain('GRANT SELECT, INSERT ON TABLE "schedule_changes" TO "sql_tool"');
    expect(s).toContain(
      'GRANT UPDATE ("delete_reason_category", "delete_reason_text") ON TABLE "schedule_changes" TO "sql_tool"',
    );
  });

  it('권한 없음 테이블·뷰에는 아무 GRANT도 만들지 않는다', () => {
    const s = build();
    for (const name of [
      'users',
      'pending_modify',
      'slack_user_mappings',
      'pattern_summary',
      'schedule_fate',
    ]) {
      expect(s.some((sql) => sql.includes(`"${name}"`))).toBe(false);
    }
  });

  it('시퀀스 USAGE는 INSERT 권한을 준 테이블의 것에만 준다', () => {
    const usage = build().filter((sql) => sql.startsWith('GRANT USAGE'));
    expect(usage).toEqual([
      'GRANT USAGE ON SEQUENCE "schedule_changes_id_seq" TO "sql_tool"',
      'GRANT USAGE ON SEQUENCE "schedules_id_seq" TO "sql_tool"',
    ]);
  });

  it('DB에 없는 테이블과 목록에 없는 테이블에는 GRANT를 만들지 않는다', () => {
    const s = build({ tables: ['schedules', 'unknown_table'], sequences: [] });
    expect(s.filter((sql) => sql.startsWith('GRANT'))).toEqual([
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "schedules" TO "sql_tool"',
    ]);
  });

  it('역할 이름을 인용해 넣는다', () => {
    const s = build({ role: 'odd"role', tables: ['expenses'], sequences: [] });
    expect(s[0]).toBe('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "odd""role"');
    expect(s).toContain('GRANT SELECT ON TABLE "expenses" TO "odd""role"');
  });

  it('입력 순서와 상관없이 같은 문을 만든다', () => {
    expect(build({ tables: [...ALL_TABLES].reverse() })).toEqual(build());
  });
});

describe('startSqlToolPool', () => {
  const TOOL_URL = 'postgresql://sql_tool@localhost/test';
  type Connect = (url: string) => Promise<void>;
  type Sync = (url: string) => Promise<boolean>;
  const LOCAL = { required: false };
  const PROD = { required: true };
  const setup = (
    sync: Sync,
  ): {
    connect: ReturnType<typeof vi.fn<Connect>>;
    deps: {
      sync: ReturnType<typeof vi.fn<Sync>>;
      connect: ReturnType<typeof vi.fn<Connect>>;
      isConnected: () => boolean;
    };
  } => {
    // 실제 풀 대신 연결 함수가 불렸는지로 연결 여부를 흉내 낸다
    let opened = false;
    const connect = vi.fn<Connect>(async (url) => {
      opened = url !== '';
    });
    return { connect, deps: { sync: vi.fn<Sync>(sync), connect, isConnected: () => opened } };
  };

  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setSqlToolPoolRequired(false);
  });

  it('동기화에 성공하면 도구 풀을 열고 전용 역할 연결을 true로 돌려준다', async () => {
    const { connect, deps } = setup(async () => true);
    await expect(startSqlToolPool(TOOL_URL, LOCAL, deps)).resolves.toBe(true);
    expect(deps.sync).toHaveBeenCalledWith(TOOL_URL);
    expect(connect).toHaveBeenCalledWith(TOOL_URL);
    expect(log).toHaveBeenCalledWith('[DB] SQL 도구 전용 역할 연결: true (운영 필수: false)');
  });

  it('동기화를 건너뛰면 도구 풀을 열지 않고 경고한다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { connect, deps } = setup(async () => false);
    await expect(startSqlToolPool(TOOL_URL, LOCAL, deps)).resolves.toBe(false);
    expect(connect).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      '[DB] 도구 역할 권한을 맞추지 못해 SQL 도구가 기존 연결 풀을 씁니다',
    );
  });

  it('동기화가 실패해도 시작을 멈추지 않고 도구 풀을 열지 않는다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { connect, deps } = setup(async () => {
      throw new Error('permission denied');
    });
    await expect(startSqlToolPool(TOOL_URL, LOCAL, deps)).resolves.toBe(false);
    expect(error).toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it('연결 문자열이 비었으면 동기화 없이 연결 함수에 경고를 맡긴다', async () => {
    const { connect, deps } = setup(async () => true);
    await expect(startSqlToolPool('', LOCAL, deps)).resolves.toBe(false);
    expect(deps.sync).not.toHaveBeenCalled();
    expect(connect).toHaveBeenCalledWith('');
  });

  it('운영에서 도구 풀이 열리지 않으면 거절 상태를 에러 로그로 남긴다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { deps } = setup(async () => false);
    await expect(startSqlToolPool(TOOL_URL, PROD, deps)).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith('[DB] 도구 역할 권한을 맞추지 못해 SQL 도구 실행을 거절합니다');
    expect(log).toHaveBeenCalledWith('[DB] SQL 도구 전용 역할 연결: false (운영 필수: true)');
    expect(error).toHaveBeenCalledWith(expect.stringContaining('실행을 거절합니다'));
  });

  it('운영에서 연결 문자열이 없어도 시작을 멈추지 않고 거절 상태로 남는다', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { deps } = setup(async () => true);
    await expect(startSqlToolPool('', PROD, deps)).resolves.toBe(false);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('실행을 거절합니다'));
  });

  it('운영에서 도구 풀이 열리면 거절 로그를 남기지 않는다', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { deps } = setup(async () => true);
    await expect(startSqlToolPool(TOOL_URL, PROD, deps)).resolves.toBe(true);
    expect(error).not.toHaveBeenCalled();
  });
});
