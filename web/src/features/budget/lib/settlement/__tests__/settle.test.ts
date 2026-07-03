import { describe, it, expect } from 'vitest';
import { buildSettlementSnapshot } from '../settle';
import type { MonthlyBudget, SettlementInput } from '../../types-v2';

describe('E. 월 경계 정산', () => {
  describe('E-2. buildSettlementSnapshot', () => {
    it('입력값 → 스냅샷 구조 정확히 매핑', () => {
      const monthlyBudget: MonthlyBudget = {
        yearMonth: '2026-04',
        allocatedDays: 31,
        fixed: 200000,
        installments: 50000,
        planned: 30000,
        free: 500000,
        isCurrent: false,
      };
      const input: SettlementInput = {
        yearMonth: '2026-04',
        monthlyBudget,
        actualFlexibleSpent: 480000,
        actualExcludedSpent: 80000,
        actualIncome: 50000,
        availableAtStart: 3000000,
        availableAtEnd: 2190000,
      };
      const snapshot = buildSettlementSnapshot(input);

      expect(snapshot.year_month).toBe('2026-04');
      expect(snapshot.allocated_budget).toBe(500000);
      expect(snapshot.fixed_total).toBe(200000);
      expect(snapshot.installment_total).toBe(50000);
      expect(snapshot.planned_total).toBe(30000);
      expect(snapshot.flexible_spent).toBe(480000);
      expect(snapshot.excluded_spent).toBe(80000);
      expect(snapshot.income_total).toBe(50000);
      expect(snapshot.available_at_start).toBe(3000000);
      expect(snapshot.available_at_end).toBe(2190000);
    });
  });
});
