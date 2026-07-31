import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PAYMENT_METHOD,
  IMMEDIATE_PAYMENT_METHODS,
  PAYMENT_METHOD_OPTIONS,
  getWithdrawalTiming,
  isKnownPaymentMethod,
} from '../payment-methods';
import { CARD_BILLING_CYCLES, getBillingMonthForExpense } from '../card-billing';

describe('getWithdrawalTiming', () => {
  it('현금은 즉시 출금', () => {
    expect(getWithdrawalTiming('현금')).toBe('immediate');
  });

  it('카드는 후불', () => {
    expect(getWithdrawalTiming('현대카드')).toBe('deferred');
    expect(getWithdrawalTiming('국민카드')).toBe('deferred');
    expect(getWithdrawalTiming('기타')).toBe('deferred');
  });

  it('미등록 수단·null은 보수적으로 후불 취급', () => {
    expect(getWithdrawalTiming('토스페이')).toBe('deferred');
    expect(getWithdrawalTiming(null)).toBe('deferred');
  });
});

describe('결제수단 목록', () => {
  it('IMMEDIATE_PAYMENT_METHODS는 즉시 출금 수단만 포함', () => {
    expect(IMMEDIATE_PAYMENT_METHODS).toEqual(['현금']);
  });

  it('은퇴한 수단은 미등록 취급 — 보수적으로 후불', () => {
    expect(isKnownPaymentMethod('계좌이체')).toBe(false);
    expect(getWithdrawalTiming('계좌이체')).toBe('deferred');
  });

  it('기본 결제수단은 등록된 수단', () => {
    expect(isKnownPaymentMethod(DEFAULT_PAYMENT_METHOD)).toBe(true);
    expect(PAYMENT_METHOD_OPTIONS).toContain(DEFAULT_PAYMENT_METHOD);
  });

  it('미등록 수단은 false', () => {
    expect(isKnownPaymentMethod('토스페이')).toBe(false);
    expect(isKnownPaymentMethod('')).toBe(false);
  });
});

describe('CARD_BILLING_CYCLES 파생 (payment-methods 단일 정의)', () => {
  it('startDay를 가진 수단만 추려진다', () => {
    expect(CARD_BILLING_CYCLES).toEqual({
      현대카드: { startDay: 15 },
      국민카드: { startDay: 13 },
    });
  });

  it('귀속 월 계산은 파생 이후에도 동일 — 현대카드 경계일 전후', () => {
    expect(getBillingMonthForExpense('2026-07-14', '현대카드')).toBe('2026-07');
    expect(getBillingMonthForExpense('2026-07-15', '현대카드')).toBe('2026-08');
  });

  it('귀속 월 계산은 파생 이후에도 동일 — 국민카드 경계일 전후', () => {
    expect(getBillingMonthForExpense('2026-07-12', '국민카드')).toBe('2026-07');
    expect(getBillingMonthForExpense('2026-07-13', '국민카드')).toBe('2026-08');
  });

  it('현금은 기본 경계(15일)를 따른다 — 즉시 출금이어도 귀속 월 규칙은 무변경', () => {
    expect(getBillingMonthForExpense('2026-07-14', '현금')).toBe('2026-07');
    expect(getBillingMonthForExpense('2026-07-15', '현금')).toBe('2026-08');
  });
});
