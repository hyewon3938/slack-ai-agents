import { describe, it, expect, vi, beforeEach } from 'vitest';

// getCurrentBillingMonth 결정론화 — 모든 테스트가 같은 billing month를 보도록 고정
vi.mock('../../billing/cycle', () => ({
  getCurrentBillingMonth: () => '2026-05',
}));

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

vi.mock('../assets-repo', () => ({
  applyAssetDeduction: vi.fn(),
  applyAssetIncrease: vi.fn(),
}));

import { query, queryOne } from '@/lib/db';
import { applyAssetDeduction, applyAssetIncrease } from '../assets-repo';
import {
  analyzeTargetDateChange,
  applyTargetDateChange,
  computeInstallmentToggleAdjustment,
  applyInstallmentToggleAdjustment,
} from '../settings-repo';

// biome-ignore lint/suspicious/noExplicitAny: test mock convenience
type Any = any;

const USER = 1;

function mockTargetDate(td: string | null) {
  vi.mocked(query).mockResolvedValueOnce({ rows: [{ target_date: td }] } as Any);
}

describe('analyzeTargetDateChange — ADR 0018 target_date 변경 영향 분석', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('oldTargetDate === newTargetDate → affectedGroups 빈 배열', async () => {
    mockTargetDate('2026-08');

    const result = await analyzeTargetDateChange(USER, '2026-08');

    expect(result.affectedGroups).toEqual([]);
    expect(result.totalDelta).toBe(0);
    // SELECT(readTargetMonth)만 1회, 미래 회차 SELECT는 호출 안 됨
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('target 늘어남 (2026-08 → 2026-10) — 새 범위 안의 회차분만큼 추가 차감', async () => {
    mockTargetDate('2026-08'); // old
    // OFF 할부 미래 회차들 — 9월/10월/11월 회차 (groupA), 12월 회차 (groupB)
    vi.mocked(query).mockResolvedValueOnce({
      rows: [
        { installment_group: 'A', description: 'foo', amount: 100_000, billing_month: '2026-09' },
        { installment_group: 'A', description: 'foo', amount: 100_000, billing_month: '2026-10' },
        { installment_group: 'A', description: 'foo', amount: 100_000, billing_month: '2026-11' },
        { installment_group: 'B', description: 'bar', amount: 200_000, billing_month: '2026-12' },
      ],
    } as Any);

    const result = await analyzeTargetDateChange(USER, '2026-10');

    // old=2026-08: 9월/10월/11월 모두 boundary 밖 (차감 안 됨)
    // new=2026-10: 9월/10월이 boundary 안으로 들어옴 → +100k씩 추가 차감
    // A: 9월(+100k) + 10월(+100k) + 11월(변화없음) → delta = +200_000
    // B: 12월(여전히 밖) → 변화 없음 → 그룹 자체 제외
    expect(result.affectedGroups).toEqual([
      { groupId: 'A', description: 'foo', deltaAmount: 200_000 },
    ]);
    expect(result.totalDelta).toBe(200_000);
  });

  it('target 줄어듦 (2026-12 → 2026-09) — 새 범위 밖으로 나간 회차분 환원', async () => {
    mockTargetDate('2026-12');
    vi.mocked(query).mockResolvedValueOnce({
      rows: [
        { installment_group: 'A', description: 'foo', amount: 100_000, billing_month: '2026-10' },
        { installment_group: 'A', description: 'foo', amount: 100_000, billing_month: '2026-11' },
      ],
    } as Any);

    const result = await analyzeTargetDateChange(USER, '2026-09');

    // 10월: was in target(was차감) → not in target(이제 무영향) → -100k
    // 11월: 동일 → -100k
    expect(result.affectedGroups).toEqual([
      { groupId: 'A', description: 'foo', deltaAmount: -200_000 },
    ]);
    expect(result.totalDelta).toBe(-200_000);
  });

  it('target=null → 모든 OFF 할부 회차 환원', async () => {
    mockTargetDate('2026-10');
    vi.mocked(query).mockResolvedValueOnce({
      rows: [
        { installment_group: 'A', description: null, amount: 100_000, billing_month: '2026-09' },
        { installment_group: 'A', description: null, amount: 100_000, billing_month: '2026-10' },
      ],
    } as Any);

    const result = await analyzeTargetDateChange(USER, null);

    // 9월: was in target → now not in target (null=target 없음) → -100k
    // 10월: was in target → now not in target → -100k
    expect(result.totalDelta).toBe(-200_000);
    expect(result.affectedGroups[0]?.deltaAmount).toBe(-200_000);
  });

  it('null → target 설정 — 새 범위 안 회차분만큼 추가 차감', async () => {
    mockTargetDate(null);
    vi.mocked(query).mockResolvedValueOnce({
      rows: [
        { installment_group: 'A', description: 'x', amount: 100_000, billing_month: '2026-08' },
        { installment_group: 'A', description: 'x', amount: 100_000, billing_month: '2026-12' },
      ],
    } as Any);

    const result = await analyzeTargetDateChange(USER, '2026-10');

    // 8월: was not in target → now in target → +100k
    // 12월: was not in target → still not in target → 변화 없음
    expect(result.totalDelta).toBe(100_000);
  });

  it('경계 — billing_month === targetDate는 target "이내" (<=)', async () => {
    mockTargetDate('2026-08');
    vi.mocked(query).mockResolvedValueOnce({
      rows: [
        { installment_group: 'A', description: null, amount: 100_000, billing_month: '2026-10' },
      ],
    } as Any);

    // target 2026-08 → 2026-10 (확장)
    const result = await analyzeTargetDateChange(USER, '2026-10');

    // 10월 회차: was billing(10) > old target(8) → 밖, will billing(10) <= new target(10) → 이내 → +100k
    expect(result.totalDelta).toBe(100_000);
  });
});

describe('applyTargetDateChange — 영향 분석 + 자산 보정 + UPSERT', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('totalDelta > 0 → applyAssetDeduction 호출', async () => {
    mockTargetDate('2026-08'); // analyze 내부 readTargetMonth
    vi.mocked(query).mockResolvedValueOnce({
      rows: [
        { installment_group: 'A', description: null, amount: 100_000, billing_month: '2026-10' },
      ],
    } as Any);
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as Any); // upsertTargetDate

    await applyTargetDateChange(USER, '2026-10');

    expect(applyAssetDeduction).toHaveBeenCalledWith(USER, 100_000);
    expect(applyAssetIncrease).not.toHaveBeenCalled();
  });

  it('totalDelta < 0 → applyAssetIncrease 호출 (절대값)', async () => {
    mockTargetDate('2026-10');
    vi.mocked(query).mockResolvedValueOnce({
      rows: [
        { installment_group: 'A', description: null, amount: 100_000, billing_month: '2026-10' },
      ],
    } as Any);
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as Any); // upsertTargetDate

    await applyTargetDateChange(USER, '2026-09');

    expect(applyAssetIncrease).toHaveBeenCalledWith(USER, 100_000);
    expect(applyAssetDeduction).not.toHaveBeenCalled();
  });

  it('totalDelta === 0 → 자산 변동 없음, UPSERT만', async () => {
    mockTargetDate('2026-10');
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as Any); // 미래 회차 없음
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as Any); // upsertTargetDate

    await applyTargetDateChange(USER, '2026-12');

    expect(applyAssetDeduction).not.toHaveBeenCalled();
    expect(applyAssetIncrease).not.toHaveBeenCalled();
  });
});

describe('computeInstallmentToggleAdjustment — ADR 0018 토글 사후 변경 자산 보정', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  function mockMeta(meta: { exclude_from_budget: boolean; type: string } | null) {
    vi.mocked(queryOne).mockResolvedValueOnce(meta as Any);
  }

  function mockTargetDate2(td: string | null) {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ target_date: td }] } as Any);
  }

  function mockGroupRows(rows: Array<{ amount: number; billing_month: string }>) {
    vi.mocked(query).mockResolvedValueOnce({ rows } as Any);
  }

  it('그룹 없음 → null 반환', async () => {
    mockTargetDate2('2026-08');
    mockMeta(null);

    const result = await computeInstallmentToggleAdjustment(USER, 'unknown-group', true);

    expect(result).toBeNull();
  });

  it('수입(type=income) 그룹 → deltaAmount=0 (보정 불필요)', async () => {
    mockTargetDate2('2026-08');
    mockMeta({ exclude_from_budget: false, type: 'income' });

    const result = await computeInstallmentToggleAdjustment(USER, 'A', true);

    expect(result).toEqual({ groupId: 'A', deltaAmount: 0 });
  });

  it('exclude_from_budget=true 그룹 → deltaAmount=0 (보정 불필요)', async () => {
    mockTargetDate2('2026-08');
    mockMeta({ exclude_from_budget: true, type: 'expense' });

    const result = await computeInstallmentToggleAdjustment(USER, 'A', false);

    expect(result).toEqual({ groupId: 'A', deltaAmount: 0 });
  });

  it('OFF → ON: boundary 밖 회차 합만큼 추가 차감 (+)', async () => {
    mockTargetDate2('2026-08');
    mockMeta({ exclude_from_budget: false, type: 'expense' });
    // 미래 회차: 6/7/8월(target 안), 9/10월(target 밖)
    mockGroupRows([
      { amount: 100_000, billing_month: '2026-06' },
      { amount: 100_000, billing_month: '2026-07' },
      { amount: 100_000, billing_month: '2026-08' }, // target 경계 — 안
      { amount: 100_000, billing_month: '2026-09' }, // 밖
      { amount: 100_000, billing_month: '2026-10' }, // 밖
    ]);

    const result = await computeInstallmentToggleAdjustment(USER, 'A', true);

    expect(result).toEqual({ groupId: 'A', deltaAmount: 200_000 });
  });

  it('ON → OFF: boundary 밖 회차 합만큼 환원 (-)', async () => {
    mockTargetDate2('2026-08');
    mockMeta({ exclude_from_budget: false, type: 'expense' });
    mockGroupRows([
      { amount: 100_000, billing_month: '2026-09' },
      { amount: 100_000, billing_month: '2026-10' },
    ]);

    const result = await computeInstallmentToggleAdjustment(USER, 'A', false);

    expect(result).toEqual({ groupId: 'A', deltaAmount: -200_000 });
  });

  it('target_date=null + ON → OFF: 모든 미래 회차가 boundary 밖 → 전체 환원', async () => {
    mockTargetDate2(null);
    mockMeta({ exclude_from_budget: false, type: 'expense' });
    mockGroupRows([
      { amount: 100_000, billing_month: '2026-09' },
      { amount: 100_000, billing_month: '2026-10' },
      { amount: 100_000, billing_month: '2026-11' },
    ]);

    const result = await computeInstallmentToggleAdjustment(USER, 'A', false);

    expect(result).toEqual({ groupId: 'A', deltaAmount: -300_000 });
  });

  it('boundary 안에만 있는 회차 → boundarySum=0 → deltaAmount=0', async () => {
    mockTargetDate2('2026-12');
    mockMeta({ exclude_from_budget: false, type: 'expense' });
    mockGroupRows([
      { amount: 100_000, billing_month: '2026-06' },
      { amount: 100_000, billing_month: '2026-07' },
    ]);

    const result = await computeInstallmentToggleAdjustment(USER, 'A', true);

    expect(result).toEqual({ groupId: 'A', deltaAmount: 0 });
  });
});

describe('applyInstallmentToggleAdjustment — 자산 변동 디스패처', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('deltaAmount > 0 → applyAssetDeduction', async () => {
    await applyInstallmentToggleAdjustment(USER, { groupId: 'A', deltaAmount: 100_000 });
    expect(applyAssetDeduction).toHaveBeenCalledWith(USER, 100_000);
    expect(applyAssetIncrease).not.toHaveBeenCalled();
  });

  it('deltaAmount < 0 → applyAssetIncrease (절대값)', async () => {
    await applyInstallmentToggleAdjustment(USER, { groupId: 'A', deltaAmount: -100_000 });
    expect(applyAssetIncrease).toHaveBeenCalledWith(USER, 100_000);
    expect(applyAssetDeduction).not.toHaveBeenCalled();
  });

  it('deltaAmount === 0 → 자산 변동 없음', async () => {
    await applyInstallmentToggleAdjustment(USER, { groupId: 'A', deltaAmount: 0 });
    expect(applyAssetDeduction).not.toHaveBeenCalled();
    expect(applyAssetIncrease).not.toHaveBeenCalled();
  });
});
