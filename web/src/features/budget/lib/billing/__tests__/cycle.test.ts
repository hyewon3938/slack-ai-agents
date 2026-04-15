import { describe, it, expect } from 'vitest';
import {
  getCurrentBillingMonth,
  getBillingRange,
  calcCycleDays,
  addBillingMonths,
  getBillingCycle,
  isLastDayOfCycle,
} from '../cycle';

describe('A. 빌링 주기', () => {
  describe('A-1. getCurrentBillingMonth — 15일/16일 경계', () => {
    it('15일 23:59 KST는 당월', () => {
      // 2026-04-15 23:59 KST = 2026-04-15 14:59 UTC
      const now = new Date('2026-04-15T14:59:00Z');
      expect(getCurrentBillingMonth(now)).toBe('2026-04');
    });

    it('16일 00:00 KST는 다음 월', () => {
      // 2026-04-16 00:00 KST = 2026-04-15 15:00 UTC
      const now = new Date('2026-04-15T15:00:00Z');
      expect(getCurrentBillingMonth(now)).toBe('2026-05');
    });

    it('월말(31일) → 다음 월로 올바르게 넘어감', () => {
      // 2026-03-16 → 2026-04
      const now = new Date('2026-03-16T00:00:00+09:00');
      expect(getCurrentBillingMonth(now)).toBe('2026-04');
    });

    it('12월 16일 → 다음 해 1월', () => {
      const now = new Date('2025-12-16T00:00:00+09:00');
      expect(getCurrentBillingMonth(now)).toBe('2026-01');
    });
  });

  describe('A-2. getBillingRange', () => {
    it("'2026-04' → { from: '2026-03-16', to: '2026-04-15' }", () => {
      expect(getBillingRange('2026-04')).toEqual({
        from: '2026-03-16',
        to: '2026-04-15',
      });
    });

    it('1월인 경우 전년 12월 16일', () => {
      expect(getBillingRange('2026-01')).toEqual({
        from: '2025-12-16',
        to: '2026-01-15',
      });
    });
  });

  describe('A-3. calcCycleDays', () => {
    it("'2026-03-16' ~ '2026-04-15' = 31일", () => {
      expect(calcCycleDays('2026-03-16', '2026-04-15')).toBe(31);
    });

    it('2월 포함 주기 (2025-01-16 ~ 2025-02-15) = 31일', () => {
      expect(calcCycleDays('2025-01-16', '2025-02-15')).toBe(31);
    });

    it('같은 날 = 1일', () => {
      expect(calcCycleDays('2026-04-01', '2026-04-01')).toBe(1);
    });
  });

  describe('addBillingMonths', () => {
    it('+1 증가', () => {
      expect(addBillingMonths('2026-04', 1)).toBe('2026-05');
    });

    it('12월 +1 = 다음 해 1월', () => {
      expect(addBillingMonths('2025-12', 1)).toBe('2026-01');
    });

    it('+0 = 자기 자신', () => {
      expect(addBillingMonths('2026-04', 0)).toBe('2026-04');
    });
  });

  describe('getBillingCycle', () => {
    it('현재 날짜 기반 BillingCycle 객체 반환', () => {
      const now = new Date('2026-04-10T10:00:00+09:00');
      const cycle = getBillingCycle(now);
      expect(cycle.yearMonth).toBe('2026-04');
      expect(cycle.from).toBe('2026-03-16');
      expect(cycle.to).toBe('2026-04-15');
      expect(cycle.totalDays).toBe(31);
    });
  });

  describe('isLastDayOfCycle', () => {
    it('15일 = true', () => {
      expect(isLastDayOfCycle('2026-04-15')).toBe(true);
    });

    it('14일 = false', () => {
      expect(isLastDayOfCycle('2026-04-14')).toBe(false);
    });

    it('1월 15일 = true', () => {
      expect(isLastDayOfCycle('2026-01-15')).toBe(true);
    });
  });
});
