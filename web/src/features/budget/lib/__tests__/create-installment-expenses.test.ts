import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

import { queryOne } from '@/lib/db';
import { createInstallmentExpenses } from '../queries';

// vi.mocked()는 실제 시그니처(QueryResult)를 요구해서 부분 목 객체를 넘길 수 없다.
const mockQueryOne = queryOne as unknown as Mock;

/** INSERT 파라미터 배열에서 exclude_from_budget 자리($12) 값을 꺼낸다. */
function excludeParamOf(callIndex: number): unknown {
  const params = mockQueryOne.mock.calls[callIndex][1] as unknown[];
  return params[11];
}

describe('createInstallmentExpenses — 할부 × 예산 제외 조합 차단 (#549)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockQueryOne.mockResolvedValue({ id: 1 });
  });

  it('예산 제외가 기본인 카테고리도 회차 전부 exclude_from_budget=false로 저장', async () => {
    await createInstallmentExpenses(1, {
      date: '2026-08-01',
      totalAmount: 300000,
      months: 3,
      category: '리커밋 사업',
      payment_method: '현대카드',
    });

    // DB CHECK(expenses_installment_not_excluded)에 걸리는 조합이 한 회차도 나가면 안 된다
    expect(mockQueryOne).toHaveBeenCalledTimes(3);
    expect([excludeParamOf(0), excludeParamOf(1), excludeParamOf(2)]).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('회차 금액은 끝전을 마지막 회차가 흡수해 총액과 일치', async () => {
    await createInstallmentExpenses(1, {
      date: '2026-08-01',
      totalAmount: 100000,
      months: 3,
      category: '쇼핑',
      payment_method: '현대카드',
    });

    const amounts = mockQueryOne.mock.calls.map((c) => (c[1] as unknown[])[2] as number);
    expect(amounts).toEqual([33333, 33333, 33334]);
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(100000);
  });
});
