import { describe, it, expect, vi, beforeEach } from 'vitest';

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

// biome-ignore lint/suspicious/noExplicitAny: test mock convenience
type Any = any;

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
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as Any);
    const count = await ensureFixedCostExpenses(1, '2026-04');
    expect(count).toBe(0);
    expect(queryOne).not.toHaveBeenCalled();
  });

  it('day_of_month 없는 고정비는 skip', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{ ...baseFC, name: 'no-day', day_of_month: null }],
    } as Any);
    const count = await ensureFixedCostExpenses(1, '2026-04');
    expect(count).toBe(0);
    expect(queryOne).not.toHaveBeenCalled();
  });

  it('active=false 고정비는 skip', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{ ...baseFC, name: 'inactive', day_of_month: 10, active: false }],
    } as Any);
    const count = await ensureFixedCostExpenses(1, '2026-04');
    expect(count).toBe(0);
    expect(queryOne).not.toHaveBeenCalled();
  });

  it('결제일이 오늘 이후 → skip (아직 안 지났음)', async () => {
    vi.mocked(getTodayISO).mockReturnValue('2026-04-10');
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{ ...baseFC, name: 'future', day_of_month: 12 }],
    } as Any);
    const count = await ensureFixedCostExpenses(1, '2026-04');
    expect(count).toBe(0);
    expect(queryOne).not.toHaveBeenCalled();
  });

  it('이미 같은 날짜에 기록된 고정비는 skip (idempotent)', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{ ...baseFC, name: 'netflix', day_of_month: 10 }],
    } as Any);
    vi.mocked(queryOne).mockResolvedValueOnce({ id: 99 } as Any); // existing
    const count = await ensureFixedCostExpenses(1, '2026-04');
    expect(count).toBe(0);
    expect(queryOne).toHaveBeenCalledTimes(1); // INSERT 호출 X
  });

  it('결제일 16일 이상 → 전월로 기록 (결제주기 반영)', async () => {
    vi.mocked(getTodayISO).mockReturnValue('2026-04-10');
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{ ...baseFC, name: 'rent', day_of_month: 20 }],
    } as Any);
    vi.mocked(queryOne)
      .mockResolvedValueOnce(null) // existing check
      .mockResolvedValueOnce({ id: 100 } as Any); // insert
    const count = await ensureFixedCostExpenses(1, '2026-04');
    expect(count).toBe(1);
    // existing check: 2026-03-20 (전월로 이동)
    expect(queryOne).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('SELECT id FROM expenses'),
      [1, '2026-03-20', 'rent'],
    );
  });

  it('INSERT 시 exclude_from_budget=true + source=fixed 로 저장', async () => {
    vi.mocked(getTodayISO).mockReturnValue('2026-04-15');
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{ ...baseFC, name: '건보', day_of_month: 5 }],
    } as Any);
    vi.mocked(queryOne)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 200 } as Any);

    await ensureFixedCostExpenses(1, '2026-04');
    const insertCall = vi.mocked(queryOne).mock.calls[1];
    expect(insertCall[0]).toMatch(/INSERT INTO expenses/);
    expect(insertCall[0]).toMatch(/'fixed'/);
    expect(insertCall[0]).toMatch(/exclude_from_budget.*true|true.*\)/i);
  });

  it('여러 고정비 혼합 — created count 정확', async () => {
    vi.mocked(getTodayISO).mockReturnValue('2026-04-15');
    vi.mocked(query).mockResolvedValueOnce({
      rows: [
        { ...baseFC, id: 1, name: 'a', day_of_month: 5 },           // 2026-04-05 ← 기록 대상
        { ...baseFC, id: 2, name: 'b', day_of_month: null },        // skip
        { ...baseFC, id: 3, name: 'c', day_of_month: 25, active: false }, // skip
        { ...baseFC, id: 4, name: 'd', day_of_month: 18 },          // 2026-03-18 ← 이미 존재
      ],
    } as Any);
    vi.mocked(queryOne)
      .mockResolvedValueOnce(null)                  // a: existing → null
      .mockResolvedValueOnce({ id: 101 } as Any)    // a: insert
      .mockResolvedValueOnce({ id: 50 } as Any);    // d: existing → 있음 (skip)

    const count = await ensureFixedCostExpenses(1, '2026-04');
    expect(count).toBe(1);
  });
});
