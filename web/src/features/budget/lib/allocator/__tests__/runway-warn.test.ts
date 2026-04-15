import { describe, expect, it } from 'vitest';
import { calcRunwayShorten } from '../runway-warn';

describe('calcRunwayShorten', () => {
  it('todayRemaining null → null', () => {
    expect(calcRunwayShorten({
      todayRemaining: null, todayBudget: 50_000, totalBudget: null, totalDays: 30, daysLeft: 10,
    })).toBeNull();
  });

  it('todayRemaining >= 0 → null (초과 없음)', () => {
    expect(calcRunwayShorten({
      todayRemaining: 0, todayBudget: 50_000, totalBudget: null, totalDays: 30, daysLeft: 10,
    })).toBeNull();
    expect(calcRunwayShorten({
      todayRemaining: 10_000, todayBudget: 50_000, totalBudget: null, totalDays: 30, daysLeft: 10,
    })).toBeNull();
  });

  it('daysLeft <= 0 → null', () => {
    expect(calcRunwayShorten({
      todayRemaining: -20_000, todayBudget: 50_000, totalBudget: null, totalDays: 30, daysLeft: 0,
    })).toBeNull();
  });

  it('todayBudget > 0 — todayBudget 기준 계산', () => {
    // 초과 20000, 남은 10일, 하루 예산 50000
    // 10일 누적 초과 = 200000, 200000 / 50000 = 4일 단축
    expect(calcRunwayShorten({
      todayRemaining: -20_000, todayBudget: 50_000, totalBudget: null, totalDays: 30, daysLeft: 10,
    })).toBe(4);
  });

  it('todayBudget null — totalBudget/totalDays fallback', () => {
    // 총예산 1500000 / 30일 = 50000/일
    // 초과 25000, 남은 5일 → 125000 / 50000 = 2.5 → floor = 2
    expect(calcRunwayShorten({
      todayRemaining: -25_000, todayBudget: null, totalBudget: 1_500_000, totalDays: 30, daysLeft: 5,
    })).toBe(2);
  });

  it('todayBudget 0 + totalBudget 0 → null', () => {
    expect(calcRunwayShorten({
      todayRemaining: -10_000, todayBudget: 0, totalBudget: 0, totalDays: 30, daysLeft: 5,
    })).toBeNull();
  });

  it('totalDays 0 + todayBudget null → null', () => {
    expect(calcRunwayShorten({
      todayRemaining: -10_000, todayBudget: null, totalBudget: 1_000_000, totalDays: 0, daysLeft: 5,
    })).toBeNull();
  });
});
