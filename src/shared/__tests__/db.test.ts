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
  return { default: { Pool: MockPool } };
});

const { connectDB, query, queryOne, disconnectDB } = await import('../db.js');

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
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM schedules WHERE id = $1',
        [42],
      );
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
