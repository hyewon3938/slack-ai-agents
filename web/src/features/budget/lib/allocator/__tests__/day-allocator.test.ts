import { describe, it, expect } from 'vitest';
import { allocateTodayBudget } from '../day-allocator';

describe('C. 일 배분 (allocateTodayBudget)', () => {
  // ─── 기존 케이스 마이그레이션 ─────────────────────────────────
  describe('C-1. 기준 일 예산 — base / cycleTotalDays', () => {
    it('todayBudget = (monthBudget − currentMonthIncome) / cycleTotalDays', () => {
      // base = 30000-0 = 30000, todayBudget = round(30000/30) = 1000
      // monthBudgetRemaining = 30000 - 12000 = 18000
      // remainingAtTodayStart = 18000 + 2000 = 20000, todayRecommended = round(20000/20) = 1000
      // todayRemaining = 1000 - 2000 = -1000
      const result = allocateTodayBudget({
        monthBudget: 30000,
        flexibleSpent: 12000,
        todayFlexSpent: 2000,
        cycleTotalDays: 30,
        daysFromToday: 20,
        currentMonthIncome: 0,
      });
      expect(result.monthBudgetRemaining).toBe(18000);
      expect(result.todayBudget).toBe(1000);
      expect(result.todayRecommended).toBe(1000);
      expect(result.todayRemaining).toBe(-1000);
    });
  });

  describe('C-2. 월 예산 초과해도 todayBudget 고정 (지출 무관)', () => {
    it('flexibleSpent > monthBudget이어도 todayBudget은 변동 없음', () => {
      // todayBudget = round(30000/30) = 1000 (지출과 무관하게 고정)
      // monthBudgetRemaining = 30000 - 35000 = -5000
      // remainingAtTodayStart = -5000 + 2000 = -3000 < 0 → todayRecommended 0 클램프
      // todayRemaining = 0 - 2000 = -2000
      const result = allocateTodayBudget({
        monthBudget: 30000,
        flexibleSpent: 35000,
        todayFlexSpent: 2000,
        cycleTotalDays: 30,
        daysFromToday: 20,
        currentMonthIncome: 0,
      });
      expect(result.monthBudgetRemaining).toBe(-5000);
      expect(result.todayBudget).toBe(1000);
      expect(result.todayRecommended).toBe(0);
      expect(result.todayRemaining).toBe(-2000);
    });
  });

  describe('C-3. 오늘 이미 초과 → todayRemaining 음수', () => {
    it('todayFlexSpent > todayRecommended 이면 todayRemaining < 0', () => {
      // base=30000, todayBudget=1000
      // monthBudgetRemaining = 20000, remainingAtTodayStart = 25000, todayRecommended = 1250
      // todayRemaining = 1250 - 5000 = -3750
      const result = allocateTodayBudget({
        monthBudget: 30000,
        flexibleSpent: 10000,
        todayFlexSpent: 5000,
        cycleTotalDays: 30,
        daysFromToday: 20,
        currentMonthIncome: 0,
      });
      expect(result.todayBudget).toBe(1000);
      expect(result.todayRemaining).toBeLessThan(0);
    });
  });

  describe('C-4. cycleTotalDays=0 (방어) → todayBudget 0', () => {
    it('cycleTotalDays=0 이면 todayBudget=0 (todayRecommended는 별도 계산)', () => {
      const result = allocateTodayBudget({
        monthBudget: 10000,
        flexibleSpent: 3000,
        todayFlexSpent: 3000,
        cycleTotalDays: 0,
        daysFromToday: 10,
        currentMonthIncome: 0,
      });
      expect(result.todayBudget).toBe(0);
      // remainingAtTodayStart = (10000-3000) + 3000 = 10000, todayRecommended = round(10000/10) = 1000
      expect(result.todayRecommended).toBe(1000);
    });
  });

  describe('C-5. flexibleSpent 변동이 todayBudget에 영향 없음 (고정 예산)', () => {
    it('flexibleSpent/todayFlexSpent가 달라도 todayBudget은 동일', () => {
      const r1 = allocateTodayBudget({
        monthBudget: 20000,
        flexibleSpent: 5000,
        todayFlexSpent: 2000,
        cycleTotalDays: 30,
        daysFromToday: 20,
        currentMonthIncome: 0,
      });
      const r2 = allocateTodayBudget({
        monthBudget: 20000,
        flexibleSpent: 15000,
        todayFlexSpent: 0,
        cycleTotalDays: 30,
        daysFromToday: 20,
        currentMonthIncome: 0,
      });
      expect(r1.todayBudget).toBe(r2.todayBudget);
    });
  });

  describe('C-6. 초과/절약 다음날에도 todayBudget 불변 (재분배 없음)', () => {
    it('어제 초과 지출 또는 절약해도 오늘 todayBudget 동일', () => {
      const afterOverspend = allocateTodayBudget({
        monthBudget: 20000,
        flexibleSpent: 25000,
        todayFlexSpent: 0,
        cycleTotalDays: 30,
        daysFromToday: 20,
        currentMonthIncome: 0,
      });
      const afterSaving = allocateTodayBudget({
        monthBudget: 20000,
        flexibleSpent: 5000,
        todayFlexSpent: 0,
        cycleTotalDays: 30,
        daysFromToday: 20,
        currentMonthIncome: 0,
      });
      // todayBudget 모두 동일 = round(20000/30) = 667
      expect(afterOverspend.todayBudget).toBe(667);
      expect(afterSaving.todayBudget).toBe(667);
      // monthBudgetRemaining만 다름
      expect(afterOverspend.monthBudgetRemaining).toBe(-5000);
      expect(afterSaving.monthBudgetRemaining).toBe(15000);
    });
  });

  // ─── 신규: 이중 모델 핵심 시나리오 ───────────────────────────
  describe('C-7. 정상 페이스 — base와 today 동일', () => {
    it('10일째, 누적 10만, base 30만, 30일 사이클', () => {
      // todayBudget = round(300_000/30) = 10_000
      // monthBudgetRemaining = 200_000, remainingAtTodayStart = 200_000
      // todayRecommended = round(200_000/20) = 10_000
      const result = allocateTodayBudget({
        monthBudget: 300_000,
        flexibleSpent: 100_000,
        todayFlexSpent: 0,
        cycleTotalDays: 30,
        daysFromToday: 20,
        currentMonthIncome: 0,
      });
      expect(result.todayBudget).toBe(10_000);
      expect(result.todayRecommended).toBe(10_000);
      expect(result.monthBudgetRemaining).toBe(200_000);
    });
  });

  describe('C-8. 빠른 페이스 — todayRecommended 감소, base 유지', () => {
    it('10일째, 누적 15만 → todayRecommended < todayBudget', () => {
      // monthBudgetRemaining = 150_000, remainingAtTodayStart = 150_000
      // todayRecommended = round(150_000/20) = 7_500
      const result = allocateTodayBudget({
        monthBudget: 300_000,
        flexibleSpent: 150_000,
        todayFlexSpent: 0,
        cycleTotalDays: 30,
        daysFromToday: 20,
        currentMonthIncome: 0,
      });
      expect(result.todayBudget).toBe(10_000);
      expect(result.todayRecommended).toBe(7_500);
      expect(result.todayRecommended).toBeLessThan(result.todayBudget);
    });
  });

  describe('C-9. 적자 — todayRecommended 0 클램프, todayBudget 유지', () => {
    it('누적 32만 > monthBudget 30만 → todayRecommended=0, todayBudget=10000', () => {
      const result = allocateTodayBudget({
        monthBudget: 300_000,
        flexibleSpent: 320_000,
        todayFlexSpent: 0,
        cycleTotalDays: 30,
        daysFromToday: 20,
        currentMonthIncome: 0,
      });
      expect(result.todayBudget).toBe(10_000);
      expect(result.todayRecommended).toBe(0);
      expect(result.monthBudgetRemaining).toBe(-20_000);
    });
  });

  describe('C-10. 깊은 적자 + 소액 수입 — base 불변, todayRecommended 여전히 0', () => {
    it('누적 62만, base 30만 + 수입 7만 → 잔여 -25만, todayRecommended 0, base 유지', () => {
      // monthBudget = 370_000 (base 300_000 + 수입 70_000), currentMonthIncome = 70_000
      // baseBudget = 300_000 → todayBudget = 10_000 (수입 무관)
      // monthBudgetRemaining = 370_000 - 620_000 = -250_000 → todayRecommended 0
      const result = allocateTodayBudget({
        monthBudget: 370_000,
        flexibleSpent: 620_000,
        todayFlexSpent: 0,
        cycleTotalDays: 30,
        daysFromToday: 20,
        currentMonthIncome: 70_000,
      });
      expect(result.todayBudget).toBe(10_000);
      expect(result.todayRecommended).toBe(0);
      expect(result.monthBudgetRemaining).toBe(-250_000);
    });
  });

  describe('C-11. 적자 + 큰 수입 — todayRecommended 회복, base 불변', () => {
    it('수입 39만 들어와 잔여 양수 진입, 10일 남음 → todayRecommended=7000, todayBudget=10000', () => {
      // monthBudget = 690_000 (base 300_000 + 수입 390_000), currentMonthIncome = 390_000
      // baseBudget = 300_000 → todayBudget = 10_000
      // monthBudgetRemaining = 690_000 - 620_000 = 70_000
      // todayRecommended = round(70_000/10) = 7_000
      const result = allocateTodayBudget({
        monthBudget: 690_000,
        flexibleSpent: 620_000,
        todayFlexSpent: 0,
        cycleTotalDays: 30,
        daysFromToday: 10,
        currentMonthIncome: 390_000,
      });
      expect(result.todayBudget).toBe(10_000);
      expect(result.todayRecommended).toBe(7_000);
      expect(result.monthBudgetRemaining).toBe(70_000);
    });
  });

  describe('C-12. 잉여 + 5일 — todayRecommended 인상, base 유지', () => {
    it('잔여 7만 + 5일 → todayRecommended 14_000', () => {
      const result = allocateTodayBudget({
        monthBudget: 300_000,
        flexibleSpent: 230_000,
        todayFlexSpent: 0,
        cycleTotalDays: 30,
        daysFromToday: 5,
        currentMonthIncome: 0,
      });
      expect(result.todayBudget).toBe(10_000);
      expect(result.todayRecommended).toBe(14_000);
      expect(result.todayRecommended).toBeGreaterThan(result.todayBudget);
    });
  });

  describe('C-13. 잉여 + 10일 — todayRecommended 7천', () => {
    it('잔여 7만 + 10일 → todayRecommended 7_000', () => {
      const result = allocateTodayBudget({
        monthBudget: 300_000,
        flexibleSpent: 230_000,
        todayFlexSpent: 0,
        cycleTotalDays: 30,
        daysFromToday: 10,
        currentMonthIncome: 0,
      });
      expect(result.todayBudget).toBe(10_000);
      expect(result.todayRecommended).toBe(7_000);
    });
  });

  // ─── 경계 케이스 ─────────────────────────────────────────
  describe('C-14. daysFromToday=0 방어 → todayRecommended=0', () => {
    it('daysFromToday=0 이면 0 division 방지', () => {
      const result = allocateTodayBudget({
        monthBudget: 100_000,
        flexibleSpent: 50_000,
        todayFlexSpent: 0,
        cycleTotalDays: 30,
        daysFromToday: 0,
        currentMonthIncome: 0,
      });
      expect(result.todayRecommended).toBe(0);
    });
  });

  describe('C-15. currentMonthIncome=0 회귀 — 단순 base', () => {
    it('수입 없을 때 base = monthBudget, todayBudget = monthBudget/cycleTotalDays', () => {
      const result = allocateTodayBudget({
        monthBudget: 300_000,
        flexibleSpent: 0,
        todayFlexSpent: 0,
        cycleTotalDays: 30,
        daysFromToday: 30,
        currentMonthIncome: 0,
      });
      expect(result.todayBudget).toBe(10_000);
      expect(result.todayRecommended).toBe(10_000);
    });
  });

  describe('C-16. 사이클 첫날 — daysFromToday = cycleTotalDays', () => {
    it('첫날: todayRecommended = monthBudget / cycleTotalDays = todayBudget', () => {
      const result = allocateTodayBudget({
        monthBudget: 300_000,
        flexibleSpent: 0,
        todayFlexSpent: 0,
        cycleTotalDays: 30,
        daysFromToday: 30,
        currentMonthIncome: 0,
      });
      expect(result.todayBudget).toBe(10_000);
      expect(result.todayRecommended).toBe(10_000);
    });
  });

  describe('C-17. Math.round 경계 — 0.5 케이스', () => {
    it('Math.round(2.5) = 3 (JS half-to-even 아님, half-away-from-zero)', () => {
      // base = 5/5 = 1 → todayBudget = 1
      // remainingAtTodayStart = 5, daysFromToday = 2 → 2.5 → round = 3
      const result = allocateTodayBudget({
        monthBudget: 5,
        flexibleSpent: 0,
        todayFlexSpent: 0,
        cycleTotalDays: 5,
        daysFromToday: 2,
        currentMonthIncome: 0,
      });
      expect(result.todayBudget).toBe(1);
      expect(result.todayRecommended).toBe(3);
    });
  });
});
