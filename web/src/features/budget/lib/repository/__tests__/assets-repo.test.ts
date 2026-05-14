import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
}));

import { query } from '@/lib/db';
import { applyAssetDeduction, applyAssetIncrease, getDefaultAssetId } from '../assets-repo';

// biome-ignore lint/suspicious/noExplicitAny: test mock convenience
type Any = any;

function mockCandidates(rows: Array<{ id: number; available_amount: number }>) {
  vi.mocked(query).mockResolvedValueOnce({ rows } as Any);
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
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as Any); // UPDATE

    const result = await applyAssetDeduction(1, 30_000);

    expect(result).toEqual([{ assetId: 10, delta: -30_000 }]);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('default 자산 부족 → fallback 자산으로 cascade', async () => {
    mockCandidates([
      { id: 10, available_amount: 50_000 }, // default
      { id: 20, available_amount: 100_000 }, // fallback 후보
    ]);
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as Any); // UPDATE 1
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as Any); // UPDATE 2

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
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as Any);
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as Any);

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
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as Any);
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as Any);

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
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ id: 42 }] } as Any); // getDefaultAssetId
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as Any); // UPDATE

    const result = await applyAssetIncrease(1, 100_000);

    expect(result).toEqual([{ assetId: 42, delta: 100_000 }]);
  });

  it('default 없으면 is_emergency=false 첫 자산으로 fallback', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as Any); // getDefaultAssetId → null
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ id: 7 }] } as Any); // fallback
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as Any); // UPDATE

    const result = await applyAssetIncrease(1, 50_000);

    expect(result).toEqual([{ assetId: 7, delta: 50_000 }]);
  });

  it('default도 fallback도 없으면 빈 배열 (DB 변동 없음)', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as Any); // getDefaultAssetId → null
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as Any); // fallback → null

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
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ id: 99 }] } as Any);
    const id = await getDefaultAssetId(1);
    expect(id).toBe(99);
  });

  it('없으면 null', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as Any);
    const id = await getDefaultAssetId(1);
    expect(id).toBeNull();
  });
});
