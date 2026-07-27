import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));
vi.mock('../repository/expenses-repo', () => ({
  readFlexibleSpent: vi.fn(),
  readTodayFlexSpent: vi.fn(),
}));

import { query, queryOne } from '@/lib/db';
import { readFlexibleSpent } from '../repository/expenses-repo';
import { queryMonthSummary } from '../queries';

// vi.mocked()는 실제 시그니처(QueryResult)를 요구해서 부분 목 객체를 넘길 수 없다.
// 목 핸들을 여기서 한 번만 느슨하게 잡고, 각 케이스에서는 캐스팅 없이 쓴다.
const mockQuery = query as unknown as Mock;
const mockQueryOne = queryOne as unknown as Mock;

// queryMonthSummary가 발행하는 query() 호출 순서 (queryOne은 별도 mock):
//   [0] total, [1] byCategory, [2] queryFixedCosts,
//   [3] installmentTotal, [4] incomeTotal, [5] queryPlannedExpenses
// queryOne 호출: [0] variableTotal
function primeQueries(opts?: { installmentTotal?: string; variableTotal?: string }) {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ total: '100000' }] }) // total
    .mockResolvedValueOnce({ rows: [] }) // byCategory
    .mockResolvedValueOnce({ rows: [] }) // queryFixedCosts
    .mockResolvedValueOnce({ rows: [{ total: opts?.installmentTotal ?? '0' }] }) // installment
    .mockResolvedValueOnce({ rows: [{ total: '0' }] }) // income
    .mockResolvedValueOnce({ rows: [] }); // planned
  mockQueryOne.mockResolvedValueOnce({
    total: opts?.variableTotal ?? '0',
  });
  vi.mocked(readFlexibleSpent).mockResolvedValueOnce(0);
}

describe('queryMonthSummary — 할부 exclude 플래그 정합성 (#549)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('할부 합계 쿼리에 exclude_from_budget 필터가 없어야 함 (락 집합과 동일)', async () => {
    primeQueries();

    await queryMonthSummary(1, '2026-04');

    // query 호출 [3]이 할부 합계 (is_installment=true, exclude 필터 없음)
    const installmentSql = mockQuery.mock.calls[3]![0] as string;
    expect(installmentSql).toMatch(/is_installment\s*=\s*true/i);
    expect(installmentSql).not.toMatch(/exclude_from_budget/i);
  });

  it('자유 지출(변동) 쿼리에 is_installment=false 필터가 있어야 함 (할부 분리)', async () => {
    primeQueries();

    await queryMonthSummary(1, '2026-04');

    const variableSql = mockQueryOne.mock.calls[0]![0] as string;
    expect(variableSql).toMatch(/is_installment\s*=\s*false/i);
    expect(variableSql).toMatch(/exclude_from_budget\s*=\s*false/i);
  });

  it('할부/변동 합계는 DB가 반환한 값을 그대로 반영 (exclude 플래그 조합과 무관)', async () => {
    primeQueries({ installmentTotal: '300000', variableTotal: '45000' });

    const summary = await queryMonthSummary(1, '2026-04');

    // 정규화 이후 할부는 exclude 값과 무관하게 전부 installment_total에 집계된다.
    expect(summary.installment_total).toBe(300000);
    // 변동 지출은 할부를 제외한 자유 지출만.
    expect(summary.variable_total).toBe(45000);
  });

  it('daily_avg는 variableTotal(할부 제외) 기준으로 산출', async () => {
    primeQueries({ variableTotal: '310000' });

    const summary = await queryMonthSummary(1, '2026-04');

    // 변동 지출이 양수면 daily_avg > 0 (결제주기 일수로 나눈 정수)
    expect(summary.variable_total).toBe(310000);
    expect(summary.daily_avg).toBeGreaterThan(0);
  });
});
