import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
}));

import { query } from '@/lib/db';
import {
  applyAssetDeduction,
  applyAssetIncrease,
  getDefaultAssetId,
  readFundsAsOf,
  advanceFundsAsOf,
} from '../assets-repo';

// vi.mocked()는 실제 시그니처(QueryResult)를 요구해서 부분 목 객체를 넘길 수 없다.
// 목 핸들을 여기서 한 번만 느슨하게 잡고, 각 케이스에서는 캐스팅 없이 쓴다.
const mockQuery = query as unknown as Mock;

function mockCandidates(rows: Array<{ id: number; available_amount: number }>) {
  mockQuery.mockResolvedValueOnce({ rows });
}

describe('applyAssetDeduction — cascading 차감', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('amount <= 0 → 빈 배열, DB 호출 없음', async () => {
    const result = await applyAssetDeduction(1, 0);
    expect(result).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('default 자산이 충분 → default 자산에만 차감', async () => {
    mockCandidates([
      { id: 10, available_amount: 100_000 },
      { id: 20, available_amount: 50_000 },
    ]);
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE

    const result = await applyAssetDeduction(1, 30_000);

    expect(result).toEqual([{ assetId: 10, delta: -30_000 }]);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('default 자산 부족 → fallback 자산으로 cascade', async () => {
    mockCandidates([
      { id: 10, available_amount: 50_000 }, // default
      { id: 20, available_amount: 100_000 }, // fallback 후보
    ]);
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE 1
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE 2

    const result = await applyAssetDeduction(1, 70_000);

    expect(result).toEqual([
      { assetId: 10, delta: -50_000 }, // default 전액 소진
      { assetId: 20, delta: -20_000 }, // 나머지 fallback
    ]);
  });

  it('마지막 자산은 음수 허용 (마이너스 통장 의미상)', async () => {
    mockCandidates([
      { id: 10, available_amount: 10_000 },
      { id: 20, available_amount: 5_000 }, // last = 마이너스 통장
    ]);
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await applyAssetDeduction(1, 50_000);

    // default 10k 소진 → 마지막 자산에서 잔여 40k 차감 (음수 허용)
    expect(result).toEqual([
      { assetId: 10, delta: -10_000 },
      { assetId: 20, delta: -40_000 }, // available 5k인데 40k 차감 → 음수 허용
    ]);
  });

  it('available_amount가 음수인 자산은 skip (last 제외)', async () => {
    mockCandidates([
      { id: 10, available_amount: 100_000 },
      { id: 20, available_amount: -5_000 }, // 음수 - skip 대상이지만 last면 음수 허용
      { id: 30, available_amount: 50_000 }, // last
    ]);
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await applyAssetDeduction(1, 130_000);

    // id=10: 100k, id=20: skip (delta=0), id=30 (last): 잔여 30k
    expect(result).toEqual([
      { assetId: 10, delta: -100_000 },
      { assetId: 30, delta: -30_000 },
    ]);
  });

  it('후보 자산이 없으면 빈 배열', async () => {
    mockCandidates([]);

    const result = await applyAssetDeduction(1, 10_000);

    expect(result).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1); // SELECT만, UPDATE 없음
  });
});

describe('applyAssetIncrease — default 자산 증액', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('amount <= 0 → 빈 배열', async () => {
    const result = await applyAssetIncrease(1, 0);
    expect(result).toEqual([]);
  });

  it('default 자산 있으면 거기에 증액', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 42 }] }); // getDefaultAssetId
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE

    const result = await applyAssetIncrease(1, 100_000);

    expect(result).toEqual([{ assetId: 42, delta: 100_000 }]);
  });

  it('default 없으면 is_emergency=false 첫 자산으로 fallback', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // getDefaultAssetId → null
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 7 }] }); // fallback
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE

    const result = await applyAssetIncrease(1, 50_000);

    expect(result).toEqual([{ assetId: 7, delta: 50_000 }]);
  });

  it('default도 fallback도 없으면 빈 배열 (DB 변동 없음)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // getDefaultAssetId → null
    mockQuery.mockResolvedValueOnce({ rows: [] }); // fallback → null

    const result = await applyAssetIncrease(1, 50_000);

    expect(result).toEqual([]);
    expect(query).toHaveBeenCalledTimes(2); // UPDATE 없음
  });
});

describe('getDefaultAssetId', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('is_default=true 자산 있으면 ID 반환', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 99 }] });
    const id = await getDefaultAssetId(1);
    expect(id).toBe(99);
  });

  it('없으면 null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const id = await getDefaultAssetId(1);
    expect(id).toBeNull();
  });
});

describe('readFundsAsOf — 자금 기준일 (#615)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('비상금 제외 자산의 기준일을 반환', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ as_of: '2026-07-20' }] });

    const asOf = await readFundsAsOf(1);

    expect(asOf).toBe('2026-07-20');
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toMatch(/is_emergency\s*=\s*false/i);
    expect(sql).toMatch(/MIN\(balance_as_of\)/i);
  });

  it('기준일 미상 자산이 하나라도 있으면 null (보수적)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ as_of: null }] });
    expect(await readFundsAsOf(1)).toBeNull();
  });

  it('행 없음 → null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await readFundsAsOf(1)).toBeNull();
  });
});

describe('advanceFundsAsOf — 기준일 전진 (#615)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('GREATEST로 갱신 — 기준일이 뒤로 가지 않는다', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await advanceFundsAsOf(1, '2026-08-14');

    const sql = mockQuery.mock.calls[0]![0] as string;
    const params = mockQuery.mock.calls[0]![1] as unknown[];
    // 밀린 정산이 과거 주기를 처리할 때 기준일을 되돌리면
    // 이미 나간 즉시 출금이 되살아나 한 번 더 차감된다.
    expect(sql).toMatch(/GREATEST/i);
    expect(sql).toMatch(/is_emergency\s*=\s*false/i);
    expect(params).toEqual([1, '2026-08-14']);
  });
});
