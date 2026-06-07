import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockConnect = vi.fn();
const mockRelease = vi.fn();
const mockEnd = vi.fn();

vi.mock('pg', () => {
  const MockPool = vi.fn(function (this: Record<string, unknown>) {
    this.query = mockQuery;
    this.connect = mockConnect;
    this.end = mockEnd;
  });
  return { default: { Pool: MockPool, types: { setTypeParser: vi.fn() } } };
});

const { connectDB, query, queryOne, queryReadOnly, disconnectDB } = await import('../db.js');

/** 읽기 전용 TX 제어문은 빈 결과로 처리하고 데이터 쿼리만 dataResult로 응답하는 클라이언트 mock. */
const makeReadOnlyClient = (dataResult: { rows: unknown[]; rowCount: number }) => {
  const calls: string[] = [];
  const clientQuery = vi.fn(async (text: string) => {
    calls.push(text);
    if (/^\s*(SET|BEGIN|ROLLBACK|COMMIT)/i.test(text)) return { rows: [], rowCount: 0 };
    return dataResult;
  });
  return { client: { query: clientQuery, release: mockRelease }, calls };
};

describe('db', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue({ release: mockRelease });
    mockEnd.mockResolvedValue(undefined);
    // pool 상태 초기화
    await disconnectDB();
    vi.clearAllMocks();
    mockConnect.mockResolvedValue({ release: mockRelease });
    mockEnd.mockResolvedValue(undefined);
  });

  describe('connectDB', () => {
    it('풀을 생성하고 연결을 확인한다', async () => {
      await connectDB('postgresql://test@localhost/test');
      expect(mockConnect).toHaveBeenCalled();
      expect(mockRelease).toHaveBeenCalled();
    });
  });

  describe('query', () => {
    it('pool.query에 위임한다', async () => {
      await connectDB('postgresql://test@localhost/test');
      const mockResult = { rows: [{ id: 1 }], rowCount: 1 };
      mockQuery.mockResolvedValue(mockResult);

      const result = await query('SELECT 1');
      expect(result).toEqual(mockResult);
      expect(mockQuery).toHaveBeenCalledWith('SELECT 1', undefined);
    });

    it('파라미터 바인딩을 전달한다', async () => {
      await connectDB('postgresql://test@localhost/test');
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      await query('SELECT * FROM schedules WHERE id = $1', [42]);
      expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM schedules WHERE id = $1', [42]);
    });
  });

  describe('queryOne', () => {
    it('첫 번째 행을 반환한다', async () => {
      await connectDB('postgresql://test@localhost/test');
      mockQuery.mockResolvedValue({ rows: [{ id: 1, title: 'test' }] });
      const result = await queryOne('SELECT * FROM schedules LIMIT 1');
      expect(result).toEqual({ id: 1, title: 'test' });
    });

    it('결과가 없으면 null을 반환한다', async () => {
      await connectDB('postgresql://test@localhost/test');
      mockQuery.mockResolvedValue({ rows: [] });
      const result = await queryOne('SELECT * FROM schedules WHERE id = $1', [999]);
      expect(result).toBeNull();
    });
  });

  describe('queryReadOnly — LLM 신호 실행 격리 (게이트 #2)', () => {
    it('읽기 전용 TX로 실행하고 항상 ROLLBACK한다 (COMMIT 없음)', async () => {
      await connectDB('postgresql://test@localhost/test');
      const { client, calls } = makeReadOnlyClient({ rows: [{ n: 3 }], rowCount: 1 });
      mockConnect.mockResolvedValue(client);

      const result = await queryReadOnly('SELECT 3 AS n', 5000, 5);
      expect(result.rows).toEqual([{ n: 3 }]);
      expect(calls).toContain('BEGIN');
      expect(calls).toContain('SET TRANSACTION READ ONLY');
      expect(calls.some((c) => /^\s*ROLLBACK/i.test(c))).toBe(true);
      expect(calls.some((c) => /^\s*COMMIT/i.test(c))).toBe(false); // 쓰기 경로 없음
    });

    it('rowCount가 maxRows 초과면 ROLLBACK 후 throw', async () => {
      await connectDB('postgresql://test@localhost/test');
      const { client, calls } = makeReadOnlyClient({
        rows: new Array(10).fill({ x: 1 }),
        rowCount: 10,
      });
      mockConnect.mockResolvedValue(client);

      await expect(queryReadOnly('SELECT x FROM t', 5000, 5)).rejects.toThrow(/10행/);
      expect(calls.some((c) => /^\s*ROLLBACK/i.test(c))).toBe(true);
    });

    it('실행 오류 시 ROLLBACK하고 전파한다', async () => {
      await connectDB('postgresql://test@localhost/test');
      const calls: string[] = [];
      const clientQuery = vi.fn(async (text: string) => {
        calls.push(text);
        if (/^\s*(SET|BEGIN|ROLLBACK)/i.test(text)) return { rows: [], rowCount: 0 };
        throw new Error('boom');
      });
      mockConnect.mockResolvedValue({ query: clientQuery, release: mockRelease });

      await expect(queryReadOnly('SELECT bad', 5000, 5)).rejects.toThrow('boom');
      expect(calls.some((c) => /^\s*ROLLBACK/i.test(c))).toBe(true);
      expect(mockRelease).toHaveBeenCalled();
    });
  });

  describe('disconnectDB', () => {
    it('pool.end()를 호출한다', async () => {
      await connectDB('postgresql://test@localhost/test');
      await disconnectDB();
      expect(mockEnd).toHaveBeenCalled();
    });

    it('미연결 상태에서는 아무 동작 안 한다', async () => {
      await disconnectDB();
      expect(mockEnd).not.toHaveBeenCalled();
    });
  });
});
