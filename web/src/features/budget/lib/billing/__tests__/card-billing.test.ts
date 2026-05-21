import { describe, it, expect } from 'vitest';
import { getBillingMonthForExpense, computeLastInstallmentBillingMonth } from '../card-billing';

describe('getBillingMonthForExpense — 카드별 귀속 월 판별', () => {
  describe('현대카드 (startDay=15)', () => {
    it('14일 → 현재 달 귀속 (14 < 15)', () => {
      expect(getBillingMonthForExpense('2026-04-14', '현대카드')).toBe('2026-04');
    });

    it('15일 → 다음 달 귀속 (15 >= 15)', () => {
      expect(getBillingMonthForExpense('2026-04-15', '현대카드')).toBe('2026-05');
    });

    it('1일 → 현재 달 귀속', () => {
      expect(getBillingMonthForExpense('2026-04-01', '현대카드')).toBe('2026-04');
    });

    it('31일 → 다음 달 귀속', () => {
      expect(getBillingMonthForExpense('2026-03-31', '현대카드')).toBe('2026-04');
    });
  });

  describe('국민카드 (startDay=13)', () => {
    it('12일 → 현재 달 귀속 (12 < 13)', () => {
      expect(getBillingMonthForExpense('2026-04-12', '국민카드')).toBe('2026-04');
    });

    it('13일 → 다음 달 귀속 (13 >= 13)', () => {
      expect(getBillingMonthForExpense('2026-04-13', '국민카드')).toBe('2026-05');
    });
  });

  describe('현금 (시스템 기본 startDay=15 적용)', () => {
    it('14일 → 현재 달 귀속', () => {
      expect(getBillingMonthForExpense('2026-04-14', '현금')).toBe('2026-04');
    });

    it('15일 → 다음 달 귀속', () => {
      expect(getBillingMonthForExpense('2026-04-15', '현금')).toBe('2026-05');
    });
  });

  describe('미등록 결제수단 → 시스템 기본 적용', () => {
    it('14일 → 현재 달 귀속', () => {
      expect(getBillingMonthForExpense('2026-04-14', '알수없는카드')).toBe('2026-04');
    });

    it('15일 → 다음 달 귀속', () => {
      expect(getBillingMonthForExpense('2026-04-15', '알수없는카드')).toBe('2026-05');
    });
  });

  describe('12월 → 연도 넘김 처리', () => {
    it('현대카드 12월 15일 → 2027-01', () => {
      expect(getBillingMonthForExpense('2026-12-15', '현대카드')).toBe('2027-01');
    });

    it('국민카드 12월 13일 → 2027-01', () => {
      expect(getBillingMonthForExpense('2026-12-13', '국민카드')).toBe('2027-01');
    });

    it('현대카드 12월 14일 → 2026-12 (현재 달)', () => {
      expect(getBillingMonthForExpense('2026-12-14', '현대카드')).toBe('2026-12');
    });
  });
});

describe('computeLastInstallmentBillingMonth — 할부 마지막 회차 billing_month (ADR 0018)', () => {
  it('현대카드 1회차 5월 14일 + 12개월 → 2027-04 (마지막 회차 4월 14일)', () => {
    expect(computeLastInstallmentBillingMonth('2026-05-14', 12, '현대카드')).toBe('2027-04');
  });

  it('현대카드 1회차 5월 15일 + 12개월 → 2027-05 (5월 15일 시작 → 다음달 귀속, 마지막은 2027-04-15 → 2027-05)', () => {
    expect(computeLastInstallmentBillingMonth('2026-05-15', 12, '현대카드')).toBe('2027-05');
  });

  it('국민카드 1회차 5월 13일 + 6개월 → 2026-11 (마지막 회차 10월 13일 → 11월 귀속)', () => {
    expect(computeLastInstallmentBillingMonth('2026-05-13', 6, '국민카드')).toBe('2026-11');
  });

  it('months=2 → 첫 회차 +1개월', () => {
    expect(computeLastInstallmentBillingMonth('2026-05-10', 2, '현대카드')).toBe('2026-06');
  });

  it('months=1 (할부 아님, 토글 안 노출되는 케이스라 의미 X) → 첫 회차 billing_month 그대로', () => {
    expect(computeLastInstallmentBillingMonth('2026-05-10', 1, '현대카드')).toBe('2026-05');
  });

  it('연도 넘김 — 1회차 11월 1일 + 6개월 → 2027-04', () => {
    expect(computeLastInstallmentBillingMonth('2026-11-01', 6, '현대카드')).toBe('2027-04');
  });
});
