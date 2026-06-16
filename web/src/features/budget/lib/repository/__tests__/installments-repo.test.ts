import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({ query: vi.fn() }));

import { query } from '@/lib/db';
import { readInstallmentLockByMonth } from '../installments-repo';

// biome-ignore lint/suspicious/noExplicitAny: test mock convenience
type Any = any;

describe('readInstallmentLockByMonth (#539)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('창 안 billing_month별 합을 Map으로 반환', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [
        { billing_month: '2026-04', total: 30000 },
        { billing_month: '2026-05', total: 30000 },
      ],
    } as Any);

    const result = await readInstallmentLockByMonth(1, '2026-04', '2026-06');

    expect(result).toBeInstanceOf(Map);
    expect(result.get('2026-04')).toBe(30000);
    expect(result.get('2026-05')).toBe(30000);
    expect(result.get('2026-06')).toBeUndefined(); // 할부 없는 달은 키 없음
  });

  it('SQL: is_installment=true + type=expense + billing_month BETWEEN, 건별 토글/exclude 필터 없음', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as Any);

    await readInstallmentLockByMonth(1, '2026-04', '2026-08');

    const sql = vi.mocked(query).mock.calls[0]![0] as string;
    const params = vi.mocked(query).mock.calls[0]![1] as unknown[];
    expect(sql).toMatch(/is_installment\s*=\s*true/i);
    expect(sql).toMatch(/billing_month\s+BETWEEN\s+\$2\s+AND\s+\$3/i);
    expect(sql).toMatch(/GROUP BY billing_month/i);
    // 건별 토글·exclude 무관 — 필터가 없어야 함
    expect(sql).not.toMatch(/distribute_to_runway/i);
    expect(sql).not.toMatch(/exclude_from_budget/i);
    expect(params).toEqual([1, '2026-04', '2026-08']);
  });

  it('빈 결과 → 빈 Map', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as Any);
    const result = await readInstallmentLockByMonth(1, '2026-04', '2026-04');
    expect(result.size).toBe(0);
  });
});
