import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
}));

import { query } from '@/lib/db';
import { readFlexibleSpent, readTodayFlexSpent } from '../expenses-repo';

// biome-ignore lint/suspicious/noExplicitAny: test mock convenience
type Any = any;

describe('readFlexibleSpent', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('planned_expense_id IS NULL 조건이 SQL에 포함되어야 함', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ total: '50000' }] } as Any);

    await readFlexibleSpent(1, '2026-03-16', '2026-04-15');

    expect(query).toHaveBeenCalledTimes(1);
    const sql = vi.mocked(query).mock.calls[0]![0] as string;
    expect(sql).toMatch(/planned_expense_id\s+IS\s+NULL/i);
  });

  it('예정지출 연결 건이 자유지출 합계에 포함되지 않아야 함', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ total: '30000' }] } as Any);

    const result = await readFlexibleSpent(1, '2026-03-16', '2026-04-15');

    expect(result).toBe(30000);
    const sql = vi.mocked(query).mock.calls[0]![0] as string;
    expect(sql).toMatch(/planned_expense_id\s+IS\s+NULL/i);
  });

  it('기본 필터 조건: expense 타입, exclude_from_budget=false', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ total: '0' }] } as Any);

    await readFlexibleSpent(1, '2026-03-16', '2026-04-15');

    const sql = vi.mocked(query).mock.calls[0]![0] as string;
    expect(sql).toMatch(/exclude_from_budget\s*=\s*false/i);
    expect(sql).toMatch(/type.*expense/i);
  });

  it('비할부 또는 신규 할부 1회차만 포함하는 조건이 SQL에 있어야 함', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ total: '0' }] } as Any);

    await readFlexibleSpent(1, '2026-03-16', '2026-04-15');

    const sql = vi.mocked(query).mock.calls[0]![0] as string;
    // 비할부(is_installment=false) OR (is_installment=true AND installment_num=1) 조건 포함
    expect(sql).toMatch(/is_installment\s*=\s*false/i);
    expect(sql).toMatch(/installment_num\s*=\s*1/i);
  });

  it('billing_month / date 범위 필터가 SQL에 포함되어야 함', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ total: '0' }] } as Any);

    await readFlexibleSpent(1, '2026-03-16', '2026-04-15');

    const sql = vi.mocked(query).mock.calls[0]![0] as string;
    const params = vi.mocked(query).mock.calls[0]![1] as unknown[];
    expect(sql).toMatch(/billing_month\s*=\s*\$2/i);
    expect(sql).toMatch(/date\s*<=\s*\$3/i);
    expect(params).toEqual([1, '2026-03-16', '2026-04-15']);
  });
});

describe('readTodayFlexSpent', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('planned_expense_id IS NULL 조건이 SQL에 포함되어야 함', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ total: '15000' }] } as Any);

    await readTodayFlexSpent(1, '2026-04-10', '2026-04');

    expect(query).toHaveBeenCalledTimes(1);
    const sql = vi.mocked(query).mock.calls[0]![0] as string;
    expect(sql).toMatch(/planned_expense_id\s+IS\s+NULL/i);
  });

  it('예정지출 연결 건이 오늘 자유지출에 포함되지 않아야 함', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ total: '10000' }] } as Any);

    const result = await readTodayFlexSpent(1, '2026-04-10', '2026-04');

    expect(result).toBe(10000);
    const sql = vi.mocked(query).mock.calls[0]![0] as string;
    expect(sql).toMatch(/planned_expense_id\s+IS\s+NULL/i);
  });

  it('billingMonth 인자를 받고 SQL의 1회차 조건에 전달되어야 함', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ total: '0' }] } as Any);

    await readTodayFlexSpent(1, '2026-04-10', '2026-04');

    const sql = vi.mocked(query).mock.calls[0]![0] as string;
    const params = vi.mocked(query).mock.calls[0]![1] as unknown[];
    expect(sql).toMatch(/installment_num\s*=\s*1/i);
    // 1회차 조건이 billing_month = $3 으로 묶여 있는지
    expect(sql).toMatch(/billing_month\s*=\s*\$3/i);
    expect(params).toEqual([1, '2026-04-10', '2026-04']);
  });

  it('비할부 또는 신규 할부 1회차만 포함', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ total: '0' }] } as Any);

    await readTodayFlexSpent(1, '2026-04-10', '2026-04');

    const sql = vi.mocked(query).mock.calls[0]![0] as string;
    expect(sql).toMatch(/is_installment\s*=\s*false/i);
    expect(sql).toMatch(/installment_num\s*=\s*1/i);
  });
});
