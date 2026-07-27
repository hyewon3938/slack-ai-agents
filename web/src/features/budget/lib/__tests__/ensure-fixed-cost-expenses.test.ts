import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));
vi.mock('@/lib/kst', () => ({
  getTodayISO: vi.fn(),
  getKSTDate: vi.fn(() => new Date()),
}));

import { query, queryOne } from '@/lib/db';
import { getTodayISO } from '@/lib/kst';
import { ensureFixedCostExpenses } from '../queries';

// vi.mocked()는 실제 시그니처(QueryResult)를 요구해서 부분 목 객체를 넘길 수 없다.
// 목 핸들을 여기서 한 번만 느슨하게 잡고, 각 케이스에서는 캐스팅 없이 쓴다.
const mockQuery = query as unknown as Mock;

const baseFC = {
  id: 1,
  user_id: 1,
  amount: 1000,
  category: '고정비',
  is_variable: false,
  active: true,
  memo: null,
  created_at: '2026-01-01T00:00:00Z',
};

describe('ensureFixedCostExpenses', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getTodayISO).mockReturnValue('2026-04-15');
  });

  it('활성 고정비 없음 → 0 반환, INSERT 호출 안 됨', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const count = await ensureFixedCostExpenses(1, '2026-04');
    expect(count).toBe(0);
    expect(query).toHaveBeenCalledTimes(1); // SELECT만
    expect(queryOne).not.toHaveBeenCalled();
  });

  it('day_of_month 없는 고정비는 skip', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...baseFC, name: 'no-day', day_of_month: null }],
    });
    const count = await ensureFixedCostExpenses(1, '2026-04');
    expect(count).toBe(0);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('active=false 고정비는 skip', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...baseFC, name: 'inactive', day_of_month: 10, active: false }],
    });
    const count = await ensureFixedCostExpenses(1, '2026-04');
    expect(count).toBe(0);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('결제일이 오늘 이후 → skip (아직 안 지났음)', async () => {
    vi.mocked(getTodayISO).mockReturnValue('2026-04-10');
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...baseFC, name: 'future', day_of_month: 12 }],
    });
    const count = await ensureFixedCostExpenses(1, '2026-04');
    expect(count).toBe(0);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('이미 같은 날짜에 기록된 고정비는 skip (idempotent)', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ ...baseFC, name: 'netflix', day_of_month: 10 }],
      })
      .mockResolvedValueOnce({ rowCount: 0 }); // NOT EXISTS가 전부 필터
    const count = await ensureFixedCostExpenses(1, '2026-04');
    expect(count).toBe(0);
    expect(query).toHaveBeenCalledTimes(2);
    const insertCall = mockQuery.mock.calls[1];
    expect(insertCall[0]).toMatch(/NOT EXISTS/);
  });

  it('결제일 16일 이상 → 전월로 기록 (결제주기 반영)', async () => {
    vi.mocked(getTodayISO).mockReturnValue('2026-04-10');
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ ...baseFC, name: 'rent', day_of_month: 20 }],
      })
      .mockResolvedValueOnce({ rowCount: 1 });
    const count = await ensureFixedCostExpenses(1, '2026-04');
    expect(count).toBe(1);
    // INSERT 파라미터의 date 배열이 '2026-03-20' 을 포함 (전월로 이동)
    const params = mockQuery.mock.calls[1][1];
    expect(params[0]).toBe(1); // userId
    expect(params[1]).toEqual(['2026-03-20']); // date 배열
    expect(params[4]).toEqual(['rent']); // description 배열
  });

  it('INSERT 시 exclude_from_budget=true + source=fixed 로 저장', async () => {
    vi.mocked(getTodayISO).mockReturnValue('2026-04-15');
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ ...baseFC, name: '건보', day_of_month: 5 }],
      })
      .mockResolvedValueOnce({ rowCount: 1 });

    await ensureFixedCostExpenses(1, '2026-04');
    const insertCall = mockQuery.mock.calls[1];
    expect(insertCall[0]).toMatch(/INSERT INTO expenses/);
    expect(insertCall[0]).toMatch(/'fixed'/);
    expect(insertCall[0]).toMatch(/true/); // exclude_from_budget 리터럴
  });

  it('여러 고정비 혼합 — created count 정확', async () => {
    vi.mocked(getTodayISO).mockReturnValue('2026-04-15');
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          { ...baseFC, id: 1, name: 'a', day_of_month: 5 }, // 2026-04-05 ← 기록 대상
          { ...baseFC, id: 2, name: 'b', day_of_month: null }, // skip
          { ...baseFC, id: 3, name: 'c', day_of_month: 25, active: false }, // skip
          { ...baseFC, id: 4, name: 'd', day_of_month: 18 }, // 2026-03-18 ← 이미 존재
        ],
      })
      .mockResolvedValueOnce({ rowCount: 1 }); // NOT EXISTS로 d는 필터, a만 INSERT

    const count = await ensureFixedCostExpenses(1, '2026-04');
    expect(count).toBe(1);
    // INSERT 대상 후보는 a, d (필터 통과) — 배열 길이 2
    const params = mockQuery.mock.calls[1][1];
    expect(params[1]).toHaveLength(2);
  });
});
