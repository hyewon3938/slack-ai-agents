import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
}));

import { query } from '@/lib/db';
import {
  readAvgVariableMonthly,
  readExcludedSpent,
  readFlexibleSpent,
  readPlannedOverflow,
  readTodayFlexSpent,
  readTotalCycleSpent,
} from '../expenses-repo';

// vi.mocked()는 실제 시그니처(QueryResult)를 요구해서 부분 목 객체를 넘길 수 없다.
// 목 핸들을 여기서 한 번만 느슨하게 잡고, 각 케이스에서는 캐스팅 없이 쓴다.
const mockQuery = query as unknown as Mock;

describe('readFlexibleSpent', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('planned_expense_id IS NULL 조건이 SQL에 포함되어야 함', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '50000' }] })
      .mockResolvedValueOnce({ rows: [{ overflow: '0' }] });

    await readFlexibleSpent(1, '2026-03-16', '2026-04-15');

    expect(query).toHaveBeenCalledTimes(2);
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toMatch(/planned_expense_id\s+IS\s+NULL/i);
  });

  it('예정지출 연결 건이 자유지출 합계에 포함되지 않아야 함 (direct만 합산)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '30000' }] })
      .mockResolvedValueOnce({ rows: [{ overflow: '0' }] });

    const result = await readFlexibleSpent(1, '2026-03-16', '2026-04-15');

    expect(result).toBe(30000);
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toMatch(/planned_expense_id\s+IS\s+NULL/i);
  });

  it('plannedOverflow 가산: direct 30000 + overflow 5000 = 35000', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '30000' }] })
      .mockResolvedValueOnce({ rows: [{ overflow: '5000' }] });

    const result = await readFlexibleSpent(1, '2026-03-16', '2026-04-15');

    expect(result).toBe(35000);
  });

  it('기본 필터 조건: expense 타입, exclude_from_budget=false', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '0' }] })
      .mockResolvedValueOnce({ rows: [{ overflow: '0' }] });

    await readFlexibleSpent(1, '2026-03-16', '2026-04-15');

    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toMatch(/exclude_from_budget\s*=\s*false/i);
    expect(sql).toMatch(/type.*expense/i);
  });

  it('할부는 전부 제외 — is_installment=false만, installment_num 조건 없음 (#539)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '0' }] })
      .mockResolvedValueOnce({ rows: [{ overflow: '0' }] });

    await readFlexibleSpent(1, '2026-03-16', '2026-04-15');

    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toMatch(/is_installment\s*=\s*false/i);
    // 1회차 특례 제거 — installment_num 조건이 더 이상 없어야 함
    expect(sql).not.toMatch(/installment_num/i);
  });

  it('billing_month / date 범위 필터가 SQL에 포함되어야 함', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '0' }] })
      .mockResolvedValueOnce({ rows: [{ overflow: '0' }] });

    await readFlexibleSpent(1, '2026-03-16', '2026-04-15');

    const sql = mockQuery.mock.calls[0]![0] as string;
    const params = mockQuery.mock.calls[0]![1] as unknown[];
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
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '15000' }] })
      .mockResolvedValueOnce({ rows: [{ overflow: '0' }] })
      .mockResolvedValueOnce({ rows: [{ overflow: '0' }] });

    await readTodayFlexSpent(1, '2026-04-10', '2026-04');

    expect(query).toHaveBeenCalledTimes(3);
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toMatch(/planned_expense_id\s+IS\s+NULL/i);
  });

  it('예정지출 연결 건이 오늘 자유지출에 포함되지 않아야 함 (direct만)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '10000' }] })
      .mockResolvedValueOnce({ rows: [{ overflow: '0' }] })
      .mockResolvedValueOnce({ rows: [{ overflow: '0' }] });

    const result = await readTodayFlexSpent(1, '2026-04-10', '2026-04');

    expect(result).toBe(10000);
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toMatch(/planned_expense_id\s+IS\s+NULL/i);
  });

  it('직접 쿼리는 비할부만 — params [userId, today] (billing_month는 overflow에만 전달)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '0' }] })
      .mockResolvedValueOnce({ rows: [{ overflow: '0' }] })
      .mockResolvedValueOnce({ rows: [{ overflow: '0' }] });

    await readTodayFlexSpent(1, '2026-04-10', '2026-04');

    const sql = mockQuery.mock.calls[0]![0] as string;
    const params = mockQuery.mock.calls[0]![1] as unknown[];
    expect(sql).toMatch(/is_installment\s*=\s*false/i);
    expect(sql).not.toMatch(/installment_num/i);
    expect(params).toEqual([1, '2026-04-10']);
  });

  it('할부는 전부 제외 (1회차 특례 없음)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '0' }] })
      .mockResolvedValueOnce({ rows: [{ overflow: '0' }] })
      .mockResolvedValueOnce({ rows: [{ overflow: '0' }] });

    await readTodayFlexSpent(1, '2026-04-10', '2026-04');

    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toMatch(/is_installment\s*=\s*false/i);
    expect(sql).not.toMatch(/installment_num/i);
  });

  it('일 단위 overflow: today 10000 - yesterday 0 → 10000 가산', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '5000' }] })
      .mockResolvedValueOnce({ rows: [{ overflow: '10000' }] })
      .mockResolvedValueOnce({ rows: [{ overflow: '0' }] });

    const result = await readTodayFlexSpent(1, '2026-04-10', '2026-04');

    expect(result).toBe(15000);
  });

  it('이미 초과 상태에서 추가 지출: today 15000 - yesterday 10000 → 5000 가산', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '0' }] })
      .mockResolvedValueOnce({ rows: [{ overflow: '15000' }] })
      .mockResolvedValueOnce({ rows: [{ overflow: '10000' }] });

    const result = await readTodayFlexSpent(1, '2026-04-10', '2026-04');

    expect(result).toBe(5000);
  });

  it('아직 미달이면 0 가산: today 0 - yesterday 0', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '8000' }] })
      .mockResolvedValueOnce({ rows: [{ overflow: '0' }] })
      .mockResolvedValueOnce({ rows: [{ overflow: '0' }] });

    const result = await readTodayFlexSpent(1, '2026-04-10', '2026-04');

    expect(result).toBe(8000);
  });

  it('환불·조정으로 today < yesterday: 음수 방어 → 0 가산', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '3000' }] })
      .mockResolvedValueOnce({ rows: [{ overflow: '5000' }] })
      .mockResolvedValueOnce({ rows: [{ overflow: '8000' }] });

    const result = await readTodayFlexSpent(1, '2026-04-10', '2026-04');

    expect(result).toBe(3000);
  });

  it('어제 날짜를 정확히 -1일로 계산해 readPlannedOverflow에 전달', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '0' }] })
      .mockResolvedValueOnce({ rows: [{ overflow: '0' }] })
      .mockResolvedValueOnce({ rows: [{ overflow: '0' }] });

    await readTodayFlexSpent(1, '2026-04-01', '2026-04');

    const todayParams = mockQuery.mock.calls[1]![1] as unknown[];
    const yesterdayParams = mockQuery.mock.calls[2]![1] as unknown[];
    expect(todayParams).toEqual([1, '2026-04', '2026-04-01']);
    expect(yesterdayParams).toEqual([1, '2026-04', '2026-03-31']);
  });
});

describe('readPlannedOverflow', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('예정지출 합계가 예산 미달이면 0', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ overflow: '0' }] });

    const result = await readPlannedOverflow(1, '2026-04', '2026-04-15');

    expect(result).toBe(0);
  });

  it('예정지출 초과분만 합산', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ overflow: '15000' }] });

    const result = await readPlannedOverflow(1, '2026-04', '2026-04-15');

    expect(result).toBe(15000);
  });

  it('GREATEST(used - budget, 0) 산식이 SQL에 포함', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ overflow: '0' }] });

    await readPlannedOverflow(1, '2026-04', '2026-04-15');

    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toMatch(/GREATEST\s*\(\s*used\s*-\s*budget\s*,\s*0\s*\)/i);
  });

  it('billing_month / date 필터 파라미터 전달', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ overflow: '0' }] });

    await readPlannedOverflow(1, '2026-04', '2026-04-15');

    const params = mockQuery.mock.calls[0]![1] as unknown[];
    expect(params).toEqual([1, '2026-04', '2026-04-15']);
  });

  it('user_id 필터가 LEFT JOIN 안에도 명시되어야 함', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ overflow: '0' }] });

    await readPlannedOverflow(1, '2026-04', '2026-04-15');

    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toMatch(/e\.user_id\s*=\s*p\.user_id/i);
  });
});

describe('readTotalCycleSpent (#539)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('billing_month의 모든 type=expense 합 — 할부·고정비·예정 포함 (exclude 필터 없음)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ total: '1234567' }] });

    const result = await readTotalCycleSpent(1, '2026-04');

    expect(result).toBe(1234567);
    const sql = mockQuery.mock.calls[0]![0] as string;
    const params = mockQuery.mock.calls[0]![1] as unknown[];
    expect(sql).toMatch(/billing_month\s*=\s*\$2/i);
    expect(sql).toMatch(/type.*expense/i);
    // 전체 결제분이라 exclude_from_budget·is_installment·planned 필터가 없어야 함
    expect(sql).not.toMatch(/exclude_from_budget/i);
    expect(sql).not.toMatch(/is_installment/i);
    expect(sql).not.toMatch(/planned_expense_id/i);
    expect(params).toEqual([1, '2026-04']);
  });

  it('행 없음 → 0', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await readTotalCycleSpent(1, '2026-04')).toBe(0);
  });
});

describe('readExcludedSpent (#549)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('제외 지출은 일반(비할부) 지출만 — is_installment=false 필터 포함', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ total: '20000' }] });

    const result = await readExcludedSpent(1, '2026-04');

    expect(result).toBe(20000);
    const sql = mockQuery.mock.calls[0]![0] as string;
    const params = mockQuery.mock.calls[0]![1] as unknown[];
    // 할부는 묶인 돈으로 따로 집계되므로 제외 지출에서 빠져야 함
    expect(sql).toMatch(/is_installment\s*=\s*false/i);
    expect(sql).toMatch(/exclude_from_budget\s*=\s*true/i);
    expect(sql).toMatch(/billing_month\s*=\s*\$2/i);
    expect(sql).toMatch(/type.*expense/i);
    expect(params).toEqual([1, '2026-04']);
  });

  it('행 없음 → 0', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await readExcludedSpent(1, '2026-04')).toBe(0);
  });
});

describe('readAvgVariableMonthly (#552)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('완결된 결제주기 범위 [current-N, current)를 파라미터로 전달', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ avg_monthly: '0' }] });

    // current='2026-07', months=3 → windowStart='2026-04', upper bound(exclusive)='2026-07'
    await readAvgVariableMonthly(1, 3, '2026-07');

    const params = mockQuery.mock.calls[0]![1] as unknown[];
    expect(params).toEqual([1, '2026-04', '2026-07']);
    const sql = mockQuery.mock.calls[0]![0] as string;
    // 진행 중 주기는 제외 (< current), 하한은 포함 (>= windowStart)
    expect(sql).toMatch(/billing_month\s*>=\s*\$2/i);
    expect(sql).toMatch(/billing_month\s*<\s*\$3/i);
  });

  it('할부·예정연결 제외 + billing_month 단위 집계 (이중 계상 방지)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ avg_monthly: '0' }] });

    await readAvgVariableMonthly(1, 3, '2026-07');

    const sql = mockQuery.mock.calls[0]![0] as string;
    // 할부 회차는 예측 시 락 맵으로 따로 burn → 평균에서 제외
    expect(sql).toMatch(/is_installment\s*=\s*false/i);
    // 예정지출 연결분도 예측에서 planned로 따로 반영 → 제외
    expect(sql).toMatch(/planned_expense_id\s+IS\s+NULL/i);
    // 달력월 DATE_TRUNC가 아니라 billing_month 기준 그룹핑
    expect(sql).toMatch(/GROUP BY billing_month/i);
    expect(sql).not.toMatch(/DATE_TRUNC/i);
    // 기본 필터 유지
    expect(sql).toMatch(/exclude_from_budget\s*=\s*false/i);
    expect(sql).toMatch(/type.*expense/i);
  });

  it('AVG 결과를 반올림해 반환', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ avg_monthly: '123456.7' }] });
    expect(await readAvgVariableMonthly(1, 3, '2026-07')).toBe(123457);
  });

  it('행 없음 → 0', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await readAvgVariableMonthly(1, 3, '2026-07')).toBe(0);
  });
});
