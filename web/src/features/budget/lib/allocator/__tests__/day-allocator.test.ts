import { describe, it, expect } from 'vitest';
import { allocateTodayBudget } from '../day-allocator';

describe('C. 일 배분 (allocateTodayBudget)', () => {
  describe('C-1. 정상 지출 → 남은 일수로 재분배, 월 예산 변동 없음', () => {
    it('todayBudget = budgetBeforeToday / todayIncludedDays', () => {
      // monthBudgetRemaining = 30000 - 12000 = 18000
      // budgetBeforeToday = 18000 + 2000 = 20000
      // todayIncludedDays = 7, todayBudget = round(20000/7) = 2857
      const result = allocateTodayBudget({
        monthBudget: 30000,
        flexibleSpent: 12000,
        todayFlexSpent: 2000,
        cycleRemainingDays: 6,
      });
      expect(result.monthBudgetRemaining).toBe(18000);
      expect(result.todayBudget).toBe(2857);
      expect(result.todayRemaining).toBe(857); // 2857 - 2000
    });
  });

  describe('C-2. 월 예산 초과 → todayBudget 0 클램프, monthBudgetRemaining 음수', () => {
    it('flexibleSpent > monthBudget 이면 todayBudget=0', () => {
      // monthBudgetRemaining = 30000 - 35000 = -5000
      // budgetBeforeToday = -5000 + 2000 = -3000 → 클램프
      const result = allocateTodayBudget({
        monthBudget: 30000,
        flexibleSpent: 35000,
        todayFlexSpent: 2000,
        cycleRemainingDays: 6,
      });
      expect(result.monthBudgetRemaining).toBe(-5000);
      expect(result.todayBudget).toBe(0);
      expect(result.todayRemaining).toBe(-2000); // 0 - 2000
    });
  });

  describe('C-3. 오늘 이미 초과 → todayRemaining 음수', () => {
    it('todayFlexSpent > todayBudget 이면 todayRemaining < 0', () => {
      // monthBudgetRemaining = 30000 - 10000 = 20000
      // budgetBeforeToday = 20000 + 5000 = 25000
      // todayBudget = round(25000/6) = 4167
      // todayRemaining = 4167 - 5000 = -833
      const result = allocateTodayBudget({
        monthBudget: 30000,
        flexibleSpent: 10000,
        todayFlexSpent: 5000,
        cycleRemainingDays: 5,
      });
      expect(result.todayBudget).toBe(4167);
      expect(result.todayRemaining).toBeLessThan(0);
    });
  });

  describe('C-4. cycleRemainingDays=0 (주기 마지막 날) → 1일로 나눔', () => {
    it('마지막 날 budgetBeforeToday 전액이 todayBudget', () => {
      // monthBudgetRemaining = 10000 - 3000 = 7000
      // budgetBeforeToday = 7000 + 3000 = 10000
      // todayIncludedDays = max(1, 0+1) = 1
      // todayBudget = 10000
      const result = allocateTodayBudget({
        monthBudget: 10000,
        flexibleSpent: 3000,
        todayFlexSpent: 3000,
        cycleRemainingDays: 0,
      });
      expect(result.todayBudget).toBe(10000);
      expect(result.todayRemaining).toBe(7000); // 10000 - 3000
    });
  });

  describe('C-5. 오늘 지출 복원 — todayBudget은 오늘 지출에 관계없이 동일', () => {
    it('todayFlexSpent가 달라도 todayBudget은 같음', () => {
      // flexibleSpent에 todayFlexSpent 포함되므로 복원 후 같은 budgetBeforeToday
      const r1 = allocateTodayBudget({
        monthBudget: 20000,
        flexibleSpent: 5000,   // 오늘 2000 포함
        todayFlexSpent: 2000,
        cycleRemainingDays: 9,
      });
      const r2 = allocateTodayBudget({
        monthBudget: 20000,
        flexibleSpent: 3000,   // 오늘 0 포함
        todayFlexSpent: 0,
        cycleRemainingDays: 9,
      });
      expect(r1.todayBudget).toBe(r2.todayBudget);
    });
  });
});
