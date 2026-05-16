import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockConnect = vi.fn();

vi.mock('pg', () => {
  const MockPool = vi.fn(function (this: Record<string, unknown>) {
    this.query = mockQuery;
    this.connect = mockConnect;
    this.end = vi.fn();
  });
  return { default: { Pool: MockPool, types: { setTypeParser: vi.fn() } } };
});

import { connectDB } from '../db.js';
import { classifyOutcome, executeVerificationSql } from '../llm-insight-verify.js';

beforeEach(async () => {
  vi.clearAllMocks();
  mockConnect.mockResolvedValue({
    query: mockQuery,
    release: vi.fn(),
  });
  await connectDB('postgresql://test@localhost/test');
});

describe('classifyOutcome', () => {
  it('빈 결과는 inconclusive', () => {
    expect(classifyOutcome([], 'boolean')).toBe('inconclusive');
    expect(classifyOutcome([], 'scalar_count')).toBe('inconclusive');
  });

  it('첫 값이 null/undefined면 inconclusive', () => {
    expect(classifyOutcome([{ pass: null }], 'boolean')).toBe('inconclusive');
  });

  describe('boolean', () => {
    it('true → hit', () => {
      expect(classifyOutcome([{ pass: true }], 'boolean')).toBe('hit');
    });
    it('false → miss', () => {
      expect(classifyOutcome([{ pass: false }], 'boolean')).toBe('miss');
    });
    it('"t" 문자열 → hit (pg boolean serialization)', () => {
      expect(classifyOutcome([{ pass: 't' }], 'boolean')).toBe('hit');
    });
    it('"true" 문자열 → hit', () => {
      expect(classifyOutcome([{ pass: 'true' }], 'boolean')).toBe('hit');
    });
  });

  describe('scalar_count', () => {
    it('양수 → hit', () => {
      expect(classifyOutcome([{ count: 5 }], 'scalar_count')).toBe('hit');
      expect(classifyOutcome([{ count: '3' }], 'scalar_count')).toBe('hit');
    });
    it('0 → miss', () => {
      expect(classifyOutcome([{ count: 0 }], 'scalar_count')).toBe('miss');
      expect(classifyOutcome([{ count: '0' }], 'scalar_count')).toBe('miss');
    });
  });

  describe('ratio', () => {
    it('양수 → hit', () => {
      expect(classifyOutcome([{ r: 0.5 }], 'ratio')).toBe('hit');
    });
    it('0 → miss', () => {
      expect(classifyOutcome([{ r: 0 }], 'ratio')).toBe('miss');
    });
  });
});

describe('executeVerificationSql', () => {
  it('SQL 에러 시 inconclusive + errorText', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.startsWith('SET statement_timeout')) return Promise.resolve({});
      throw new Error('syntax error at or near "FRO"');
    });

    const result = await executeVerificationSql('SELECT FRO bad', 'boolean');
    expect(result.outcome).toBe('inconclusive');
    expect(result.errorText).toContain('syntax error');
    expect(result.resultJson).toBeNull();
  });

  it('정상 boolean true → hit', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.startsWith('SET statement_timeout')) return Promise.resolve({});
      return Promise.resolve({ rows: [{ pass: true }], rowCount: 1 });
    });

    const result = await executeVerificationSql('SELECT true AS pass', 'boolean');
    expect(result.outcome).toBe('hit');
    expect(result.errorText).toBeNull();
  });

  it('빈 row → inconclusive', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.startsWith('SET statement_timeout')) return Promise.resolve({});
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await executeVerificationSql('SELECT 1 WHERE false', 'scalar_count');
    expect(result.outcome).toBe('inconclusive');
  });
});
