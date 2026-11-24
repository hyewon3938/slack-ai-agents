import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

import { query, queryOne } from '@/lib/db';
import { updateFixedCost } from '../queries/fixed-costs';
import { updatePlannedExpense } from '../queries/planned';
import { setDefaultAsset } from '../queries/assets';

// ─── 합성 픽스처 (실제 개인 데이터 아님 — 금액은 지어낸 값) ─────────────
// 동적 SET 절은 자리표시자 번호와 값 배열이 한 칸만 어긋나도 다른 컬럼에 값이 들어간다.
// 그 순서와 user_id 스코프를 고정한다.

const mockQuery = query as unknown as Mock;
const mockQueryOne = queryOne as unknown as Mock;

function lastQueryOneCall(): [string, unknown[]] {
  const call = mockQueryOne.mock.calls.at(-1) as [string, unknown[]?] | undefined;
  if (!call) throw new Error('queryOne 미호출');
  return [call[0], call[1] ?? []];
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('updateFixedCost — 동적 SET 절', () => {
  it('SET은 $3부터, WHERE는 id=$1·user_id=$2, 값은 키 순서대로', async () => {
    mockQueryOne.mockResolvedValue({ id: 5 });

    await updateFixedCost(7, 5, { amount: 1000, active: false });

    const [sql, params] = lastQueryOneCall();
    expect(sql).toContain('SET amount = $3, active = $4');
    expect(sql).toContain('WHERE id = $1 AND user_id = $2');
    expect(params).toEqual([5, 7, 1000, false]);
  });

  it('화이트리스트 밖 키(user_id·id)는 무시한다', async () => {
    mockQueryOne.mockResolvedValue({ id: 5 });

    await updateFixedCost(7, 5, { user_id: 99, id: 1, name: '통신비' });

    const [sql, params] = lastQueryOneCall();
    expect(sql).toContain('SET name = $3');
    expect(sql).not.toContain('user_id = $3');
    expect(params).toEqual([5, 7, '통신비']);
  });

  it('반영할 필드가 없으면 쿼리 없이 null', async () => {
    const result = await updateFixedCost(7, 5, { user_id: 99 });

    expect(result).toBeNull();
    expect(queryOne).not.toHaveBeenCalled();
  });
});

describe('updatePlannedExpense — 동적 SET 절', () => {
  it('amount·memo를 $3·$4로, WHERE는 id=$1·user_id=$2', async () => {
    mockQueryOne.mockResolvedValue({ id: 5 });

    await updatePlannedExpense(7, 5, { amount: 2000, memo: '여행' });

    const [sql, params] = lastQueryOneCall();
    expect(sql).toContain('SET amount = $3, memo = $4');
    expect(sql).toContain('WHERE id = $1 AND user_id = $2');
    expect(params).toEqual([5, 7, 2000, '여행']);
  });

  it('memo만 오면 memo가 $3을 차지하고, null은 지우기 값으로 반영한다', async () => {
    mockQueryOne.mockResolvedValue({ id: 5 });

    await updatePlannedExpense(7, 5, { memo: null });

    const [sql, params] = lastQueryOneCall();
    expect(sql).toContain('SET memo = $3');
    expect(sql).not.toContain('amount =');
    expect(params).toEqual([5, 7, null]);
  });

  it('필드가 없으면 쿼리 없이 null', async () => {
    const result = await updatePlannedExpense(7, 5, {});

    expect(result).toBeNull();
    expect(queryOne).not.toHaveBeenCalled();
  });
});

describe('setDefaultAsset — user당 기본 자산 1개', () => {
  it('대상 자산이 없으면(타 유저 포함) 아무것도 바꾸지 않고 null', async () => {
    mockQueryOne.mockResolvedValueOnce(null);

    const result = await setDefaultAsset(7, 5);

    expect(result).toBeNull();
    expect(query).not.toHaveBeenCalled();
    expect(queryOne).toHaveBeenCalledTimes(1);
    const [sql, params] = lastQueryOneCall();
    expect(sql).toContain('WHERE id = $1 AND user_id = $2');
    expect(params).toEqual([5, 7]);
  });

  it('비상금 자산이면 throw하고 해제·지정 UPDATE를 하지 않는다', async () => {
    mockQueryOne.mockResolvedValueOnce({ is_emergency: true });

    await expect(setDefaultAsset(7, 5)).rejects.toThrow('EMERGENCY_ASSET_CANNOT_BE_DEFAULT');
    expect(query).not.toHaveBeenCalled();
    expect(queryOne).toHaveBeenCalledTimes(1);
  });

  it('기존 기본 자산 해제 UPDATE가 새 지정 UPDATE보다 먼저 실행된다', async () => {
    mockQueryOne.mockResolvedValueOnce({ is_emergency: false }).mockResolvedValueOnce({ id: 5 });
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    await setDefaultAsset(7, 5);

    const [clearSql, clearParams] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(clearSql).toContain('SET is_default = false');
    expect(clearSql).toContain('WHERE user_id = $1');
    expect(clearParams).toEqual([7]);

    const [setSql, setParams] = lastQueryOneCall();
    expect(setSql).toContain('SET is_default = true');
    expect(setParams).toEqual([5, 7]);

    // partial unique index 충돌을 막으려면 해제가 반드시 먼저다
    const clearOrder = mockQuery.mock.invocationCallOrder[0]!;
    const setOrder = mockQueryOne.mock.invocationCallOrder[1]!;
    expect(clearOrder).toBeLessThan(setOrder);
  });
});
