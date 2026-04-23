import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockConnect = vi.fn();
const mockEnd = vi.fn();
const mockClientQuery = vi.fn();
const mockRelease = vi.fn();

vi.mock('pg', () => {
  const MockPool = vi.fn(function (this: Record<string, unknown>) {
    this.query = mockQuery;
    this.connect = mockConnect;
    this.end = mockEnd;
  });
  return { default: { Pool: MockPool, types: { setTypeParser: vi.fn() } } };
});

describe('pending-modify', () => {
  let createPendingModify: typeof import('../pending-modify.js').createPendingModify;
  let findActivePending: typeof import('../pending-modify.js').findActivePending;
  let markExecuted: typeof import('../pending-modify.js').markExecuted;
  let markCanceled: typeof import('../pending-modify.js').markCanceled;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue({ query: mockClientQuery, release: mockRelease });
    mockEnd.mockResolvedValue(undefined);

    const db = await import('../db.js');
    await db.disconnectDB();
    vi.clearAllMocks();
    mockConnect.mockResolvedValue({ query: mockClientQuery, release: mockRelease });
    mockEnd.mockResolvedValue(undefined);
    await db.connectDB('postgresql://test@localhost/test');
    vi.clearAllMocks();

    const pm = await import('../pending-modify.js');
    createPendingModify = pm.createPendingModify;
    findActivePending = pm.findActivePending;
    markExecuted = pm.markExecuted;
    markCanceled = pm.markCanceled;
  });

  it('createPendingModify: 16자 hex token 반환 + INSERT 수행', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const token = await createPendingModify({
      userId: 1,
      sqlText: 'DELETE FROM schedules WHERE user_id = 1',
      rowCount: 5,
      tableName: 'schedules',
      slackChannel: 'C123',
    });

    expect(token).toMatch(/^[a-f0-9]{16}$/);
    expect(mockQuery).toHaveBeenCalledOnce();
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO pending_modify');
    expect(sql).toContain('table_name');
    expect(params[0]).toBe(token);
    expect(params[1]).toBe(1);
    expect(params[2]).toBe('DELETE FROM schedules WHERE user_id = 1');
    expect(params[3]).toBe(5);
    expect(params[4]).toBe('schedules');
    expect(params[5]).toBe('C123');
    expect(params[6]).toBeNull();
  });

  it('findActivePending: token + userId로 SELECT 수행', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: 7, token: 'abc', user_id: 1, sql_text: 'DELETE ...' }],
      rowCount: 1,
    });

    const row = await findActivePending('abc', 1);
    expect(row?.id).toBe(7);

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('token = $1');
    expect(sql).toContain('user_id = $2');
    expect(sql).toContain('executed_at IS NULL');
    expect(sql).toContain('canceled_at IS NULL');
    expect(sql).toContain('expires_at > NOW()');
    expect(params).toEqual(['abc', 1]);
  });

  it('findActivePending: 결과 없으면 null', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    expect(await findActivePending('missing', 1)).toBeNull();
  });

  it('markExecuted: executed_at = NOW() UPDATE', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    await markExecuted(42);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('UPDATE pending_modify');
    expect(sql).toContain('executed_at = NOW()');
    expect(params).toEqual([42]);
  });

  it('markCanceled: canceled_at = NOW() UPDATE', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    await markCanceled(99);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('UPDATE pending_modify');
    expect(sql).toContain('canceled_at = NOW()');
    expect(params).toEqual([99]);
  });
});
