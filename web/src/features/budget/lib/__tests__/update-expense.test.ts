import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

import { query, queryOne } from '@/lib/db';
import { updateExpense, FIXED_SOURCE_EXCLUDE_LOCKED } from '../queries';

// vi.mocked()는 실제 시그니처(QueryResult)를 요구해서 부분 목 객체를 넘길 수 없다.
// 목 핸들을 여기서 한 번만 느슨하게 잡고, 각 케이스에서는 캐스팅 없이 쓴다.
const mockQueryOne = queryOne as unknown as Mock;

describe('updateExpense — source=fixed 행 exclude_from_budget 가드', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("source='fixed' 행 + exclude_from_budget 변경 → 에러 throw, UPDATE 미실행", async () => {
    mockQueryOne.mockResolvedValueOnce({ source: 'fixed' });

    await expect(updateExpense(1, 686, { exclude_from_budget: true })).rejects.toThrow(
      FIXED_SOURCE_EXCLUDE_LOCKED,
    );

    // SELECT source만 1회, UPDATE는 호출되지 않음
    expect(queryOne).toHaveBeenCalledTimes(1);
    expect(query).not.toHaveBeenCalled();
  });

  it("source='manual' 행 + exclude_from_budget 변경 → 가드 통과 후 단일 UPDATE", async () => {
    mockQueryOne
      .mockResolvedValueOnce({ source: 'manual' }) // 가드 SELECT
      .mockResolvedValueOnce({ id: 100, exclude_from_budget: true }); // UPDATE RETURNING

    const result = await updateExpense(1, 100, { exclude_from_budget: true });

    expect(result).toEqual({ id: 100, exclude_from_budget: true });
    expect(queryOne).toHaveBeenCalledTimes(2);
    const updateSql = mockQueryOne.mock.calls[1]![0] as string;
    expect(updateSql).toMatch(/UPDATE\s+expenses\s+SET/i);
  });
});

describe('updateExpense — 단순 화이트리스트 UPDATE (#539, 자산 보정·그룹 동기화 없음)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('amount만 변경 → 가드 SELECT 없이 단일 UPDATE', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 686, amount: 167776 });

    const result = await updateExpense(1, 686, { amount: 167776 });

    expect(result).toEqual({ id: 686, amount: 167776 });
    // exclude 미변경 → 가드 SELECT 없음. UPDATE 한 번만.
    expect(queryOne).toHaveBeenCalledTimes(1);
    const sql = mockQueryOne.mock.calls[0]![0] as string;
    expect(sql).toMatch(/UPDATE\s+expenses\s+SET\s+amount/i);
  });

  it('할부 회차 amount 변경 → 그룹 동기화·자산 보정 query() 없이 단일 행 UPDATE만', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 100, amount: 50000 });

    await updateExpense(1, 100, { amount: 50000 });

    // 등록시점 차감 폐지 → 그룹 UPDATE/자산 보정용 추가 query() 호출이 없어야 함
    expect(query).not.toHaveBeenCalled();
    expect(queryOne).toHaveBeenCalledTimes(1);
  });

  it('허용되지 않는 컬럼만 → SELECT(현재 행 반환), UPDATE 미실행', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 1, amount: 100 });

    const result = await updateExpense(1, 1, { unknown_col: 'x' });

    expect(result).toEqual({ id: 1, amount: 100 });
    expect(queryOne).toHaveBeenCalledTimes(1);
    const sql = mockQueryOne.mock.calls[0]![0] as string;
    expect(sql).toMatch(/SELECT/i);
    expect(sql).not.toMatch(/UPDATE/i);
  });

  it('distribute_to_runway는 화이트리스트에서 제외 → 단독 전달 시 UPDATE 미실행', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 5 });

    await updateExpense(1, 5, { distribute_to_runway: false });

    // 유효 키 0개 → queryExpense(SELECT)만
    expect(queryOne).toHaveBeenCalledTimes(1);
    const sql = mockQueryOne.mock.calls[0]![0] as string;
    expect(sql).toMatch(/SELECT/i);
    expect(sql).not.toMatch(/UPDATE/i);
  });
});

describe('updateExpense — 고정비 지출 금액 수정 (#615)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("source='fixed' + exclude 같은 값 재전송 + 금액 변경 → 가드 통과 후 UPDATE", async () => {
    // 변동 고정비는 정의가 아니라 그 달 지출 행에서 실제 금액을 고친다.
    mockQueryOne
      .mockResolvedValueOnce({ source: 'fixed', exclude_from_budget: true }) // 가드 SELECT
      .mockResolvedValueOnce({ id: 686, amount: 167776 }); // UPDATE RETURNING

    const result = await updateExpense(1, 686, { amount: 167776, exclude_from_budget: true });

    expect(result).toEqual({ id: 686, amount: 167776 });
    expect(queryOne).toHaveBeenCalledTimes(2);
    const updateSql = mockQueryOne.mock.calls[1]![0] as string;
    expect(updateSql).toMatch(/UPDATE\s+expenses\s+SET/i);
  });

  it("source='fixed' + exclude 값 변경 → 여전히 차단", async () => {
    mockQueryOne.mockResolvedValueOnce({ source: 'fixed', exclude_from_budget: false });

    await expect(updateExpense(1, 686, { amount: 100, exclude_from_budget: true })).rejects.toThrow(
      FIXED_SOURCE_EXCLUDE_LOCKED,
    );

    expect(queryOne).toHaveBeenCalledTimes(1);
  });
});

describe('updateExpense — 귀속 월 재계산 (#615)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('날짜가 경계를 넘으면 billing_month 를 다시 계산해 같이 UPDATE', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 686, date: '2026-07-10', payment_method: '현대카드' }) // 현재 행
      .mockResolvedValueOnce({ id: 686, date: '2026-07-15' }); // UPDATE RETURNING

    await updateExpense(1, 686, { date: '2026-07-15' });

    const updateSql = mockQueryOne.mock.calls[1]![0] as string;
    const params = mockQueryOne.mock.calls[1]![1] as unknown[];
    expect(updateSql).toMatch(/date = \$3, billing_month = \$4/);
    expect(params).toEqual([686, 1, '2026-07-15', '2026-08']);
  });

  it('결제수단이 바뀌면 그 수단의 경계일로 billing_month 재계산', async () => {
    // 7/13: 현대카드(15일 경계) 기준 2026-07 → 국민카드(13일 경계) 기준 2026-08
    mockQueryOne
      .mockResolvedValueOnce({ id: 700, date: '2026-07-13', payment_method: '현대카드' })
      .mockResolvedValueOnce({ id: 700, payment_method: '국민카드' });

    await updateExpense(1, 700, { payment_method: '국민카드' });

    const params = mockQueryOne.mock.calls[1]![1] as unknown[];
    expect(params).toEqual([700, 1, '국민카드', '2026-08']);
  });

  it('날짜·결제수단 미변경이면 현재 행 조회 없이 단일 UPDATE', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 686, category: '식비' });

    await updateExpense(1, 686, { category: '식비' });

    expect(queryOne).toHaveBeenCalledTimes(1);
    const sql = mockQueryOne.mock.calls[0]![0] as string;
    expect(sql).not.toMatch(/billing_month = /);
  });
});
