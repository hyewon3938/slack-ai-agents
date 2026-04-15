import { describe, it, expect } from 'vitest';
import { calcAllocatedDays } from '../proration';
import type { BillingCycle } from '../../types-v2';

const CYCLE_APR: BillingCycle = {
  yearMonth: '2026-04',
  from: '2026-03-16',
  to: '2026-04-15',
  totalDays: 31,
};

describe('프로레이션 — calcAllocatedDays', () => {
  it('주기 중간: elapsed + remaining = totalDays', () => {
    // today: 2026-04-11 → 4/11~4/15 = 5일 남음
    const result = calcAllocatedDays('2026-04-11', CYCLE_APR);
    expect(result.elapsed).toBe(26);   // 3/16~4/10
    expect(result.remaining).toBe(5);  // 4/11~4/15
    expect(result.allocatedDays).toBe(5);
    expect(result.elapsed + result.remaining).toBe(CYCLE_APR.totalDays);
  });

  it('주기 첫날: elapsed=0, allocatedDays=totalDays', () => {
    const result = calcAllocatedDays('2026-03-16', CYCLE_APR);
    expect(result.elapsed).toBe(0);
    expect(result.remaining).toBe(31);
    expect(result.allocatedDays).toBe(31);
  });

  it('주기 마지막 날: allocatedDays=1', () => {
    const result = calcAllocatedDays('2026-04-15', CYCLE_APR);
    expect(result.elapsed).toBe(30);
    expect(result.remaining).toBe(1);
    expect(result.allocatedDays).toBe(1);
  });

  it('주기 하루 전날: allocatedDays=2', () => {
    const result = calcAllocatedDays('2026-04-14', CYCLE_APR);
    expect(result.allocatedDays).toBe(2);
  });
});
