import { describe, it, expect } from 'vitest';
import { resolveFixedCostExpenseDate } from '../fixed-cost-date';

describe('resolveFixedCostExpenseDate', () => {
  describe('일반 케이스', () => {
    it('결제일 1일 → 당월에 기록', () => {
      expect(resolveFixedCostExpenseDate('2026-04', 1)).toBe('2026-04-01');
    });

    it('결제일 14일 (결제주기 말일) → 당월', () => {
      expect(resolveFixedCostExpenseDate('2026-04', 14)).toBe('2026-04-14');
    });

    it('결제일 15일 (결제주기 시작일) → 전월', () => {
      expect(resolveFixedCostExpenseDate('2026-04', 15)).toBe('2026-03-15');
    });

    it('결제일 31일 → 전월 말일', () => {
      expect(resolveFixedCostExpenseDate('2026-04', 31)).toBe('2026-03-31');
    });
  });

  describe('월 경계 — 14일/15일 boundary', () => {
    it('14일 ↔ 15일 경계에서 월이 바뀐다', () => {
      expect(resolveFixedCostExpenseDate('2026-04', 14)).toBe('2026-04-14');
      expect(resolveFixedCostExpenseDate('2026-04', 15)).toBe('2026-03-15');
    });
  });

  describe('연도 경계', () => {
    it('1월 + 결제일 16일 → 전년 12월', () => {
      expect(resolveFixedCostExpenseDate('2026-01', 16)).toBe('2025-12-16');
    });

    it('1월 + 결제일 14일 → 당월 1월', () => {
      expect(resolveFixedCostExpenseDate('2026-01', 14)).toBe('2026-01-14');
    });

    it('12월 + 결제일 16일 → 당년 11월', () => {
      expect(resolveFixedCostExpenseDate('2026-12', 16)).toBe('2026-11-16');
    });
  });

  describe('월말일 보정 (month-end clamp)', () => {
    it('2월 + 결제일 30일 → 전월 1월 30일 (31일 있음)', () => {
      expect(resolveFixedCostExpenseDate('2026-02', 30)).toBe('2026-01-30');
    });

    it('3월 + 결제일 31일 → 전월 2월 28일 (평년 2월 말일)', () => {
      expect(resolveFixedCostExpenseDate('2026-03', 31)).toBe('2026-02-28');
    });

    it('2025-03 + 결제일 29일 → 2025-02 말일 28일 (2025 평년)', () => {
      expect(resolveFixedCostExpenseDate('2025-03', 29)).toBe('2025-02-28');
    });

    it('2024-03 + 결제일 29일 → 2024-02-29 (2024 윤년)', () => {
      expect(resolveFixedCostExpenseDate('2024-03', 29)).toBe('2024-02-29');
    });

    it('5월 + 결제일 31일 → 4월 30일 (4월 말일)', () => {
      expect(resolveFixedCostExpenseDate('2026-05', 31)).toBe('2026-04-30');
    });

    it('7월 + 결제일 31일 → 6월 30일', () => {
      expect(resolveFixedCostExpenseDate('2026-07', 31)).toBe('2026-06-30');
    });
  });

  describe('입력 검증', () => {
    it('잘못된 yearMonth → 에러', () => {
      expect(() => resolveFixedCostExpenseDate('2026-4', 10)).toThrow();
      expect(() => resolveFixedCostExpenseDate('invalid', 10)).toThrow();
    });

    it('잘못된 dayOfMonth → 에러', () => {
      expect(() => resolveFixedCostExpenseDate('2026-04', 0)).toThrow();
      expect(() => resolveFixedCostExpenseDate('2026-04', 32)).toThrow();
      expect(() => resolveFixedCostExpenseDate('2026-04', 1.5)).toThrow();
    });
  });
});
