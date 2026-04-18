import { describe, it, expect } from 'vitest';
import { allocateTodayBudget } from '../day-allocator';

describe('C. 일 배분 (allocateTodayBudget)', () => {
  describe('C-1. 고정 하루 예산 — monthBudget / cycleTotalDays', () => {
    it('todayBudget = monthBudget / cycleTotalDays (대금기간 동안 불변)', () => {
      // todayBudget = round(30000/30) = 1000
      // monthBudgetRemaining = 30000 - 12000 = 18000
      // todayRemaining = 1000 - 2000 = -1000
      const result = allocateTodayBudget({
        monthBudget: 30000,
        flexibleSpent: 12000,
        todayFlexSpent: 2000,
        cycleTotalDays: 30,
      });
      expect(result.monthBudgetRemaining).toBe(18000);
      expect(result.todayBudget).toBe(1000);
      expect(result.todayRemaining).toBe(-1000);
    });
  });

  describe('C-2. 월 예산 초과해도 todayBudget 고정 (지출 무관)', () => {
    it('flexibleSpent > monthBudget이어도 todayBudget은 변동 없음', () => {
      // todayBudget = round(30000/30) = 1000 (지출과 무관하게 고정)
      // monthBudgetRemaining = 30000 - 35000 = -5000
      const result = allocateTodayBudget({
        monthBudget: 30000,
        flexibleSpent: 35000,
        todayFlexSpent: 2000,
        cycleTotalDays: 30,
      });
      expect(result.monthBudgetRemaining).toBe(-5000);
      expect(result.todayBudget).toBe(1000);
      expect(result.todayRemaining).toBe(-1000);
    });
  });

  describe('C-3. 오늘 이미 초과 → todayRemaining 음수', () => {
    it('todayFlexSpent > todayBudget 이면 todayRemaining < 0', () => {
      // todayBudget = round(30000/30) = 1000
      // todayRemaining = 1000 - 5000 = -4000
      const result = allocateTodayBudget({
        monthBudget: 30000,
        flexibleSpent: 10000,
        todayFlexSpent: 5000,
        cycleTotalDays: 30,
      });
      expect(result.todayBudget).toBe(1000);
      expect(result.todayRemaining).toBeLessThan(0);
    });
  });

  describe('C-4. cycleTotalDays=0 (방어) → todayBudget 0', () => {
    it('cycleTotalDays=0 이면 todayBudget=0', () => {
      const result = allocateTodayBudget({
        monthBudget: 10000,
        flexibleSpent: 3000,
        todayFlexSpent: 3000,
        cycleTotalDays: 0,
      });
      expect(result.todayBudget).toBe(0);
      expect(result.todayRemaining).toBe(-3000);
    });
  });

  describe('C-5. flexibleSpent 변동이 todayBudget에 영향 없음 (고정 예산)', () => {
    it('flexibleSpent/todayFlexSpent가 달라도 todayBudget은 동일', () => {
      const r1 = allocateTodayBudget({
        monthBudget: 20000,
        flexibleSpent: 5000,
        todayFlexSpent: 2000,
        cycleTotalDays: 30,
      });
      const r2 = allocateTodayBudget({
        monthBudget: 20000,
        flexibleSpent: 15000,
        todayFlexSpent: 0,
        cycleTotalDays: 30,
      });
      expect(r1.todayBudget).toBe(r2.todayBudget);
    });
  });

  describe('C-6. 초과/절약 다음날에도 todayBudget 불변 (재분배 없음)', () => {
    it('어제 초과 지출 또는 절약해도 오늘 todayBudget 동일', () => {
      // 어제까지 초과 지출: flexibleSpent=25000 (monthBudget=20000 초과)
      const afterOverspend = allocateTodayBudget({
        monthBudget: 20000,
        flexibleSpent: 25000,
        todayFlexSpent: 0,
        cycleTotalDays: 30,
      });
      // 어제까지 절약: flexibleSpent=5000
      const afterSaving = allocateTodayBudget({
        monthBudget: 20000,
        flexibleSpent: 5000,
        todayFlexSpent: 0,
        cycleTotalDays: 30,
      });
      // todayBudget 모두 동일 = round(20000/30) = 667
      expect(afterOverspend.todayBudget).toBe(667);
      expect(afterSaving.todayBudget).toBe(667);
      expect(afterOverspend.todayBudget).toBe(afterSaving.todayBudget);
      // monthBudgetRemaining만 다름
      expect(afterOverspend.monthBudgetRemaining).toBe(-5000);
      expect(afterSaving.monthBudgetRemaining).toBe(15000);
    });
  });
});
