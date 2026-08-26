import { CYCLE_START_DAY } from './cycle-config';

/** 출금 시점 — 통장에서 돈이 실제로 나가는 때 */
export type WithdrawalTiming =
  | 'immediate' // 기록 시점에 이미 나감 (현금)
  | 'deferred'; // 결제주기 종료 후 카드사에 결제

export interface PaymentMethodSpec {
  timing: WithdrawalTiming;
  /** 후불 수단의 대금기간 시작일 — 이 일자 이상이면 다음 달 대금 */
  startDay?: number;
}

export const PAYMENT_METHODS: Record<string, PaymentMethodSpec> = {
  // 기준 카드 — 대금기간 시작일이 곧 시스템 결제주기 시작일이다.
  현대카드: { timing: 'deferred', startDay: CYCLE_START_DAY },
  국민카드: { timing: 'deferred', startDay: 13 },
  현금: { timing: 'immediate' },
  기타: { timing: 'deferred' },
};

/**
 * 등록되지 않은 결제수단의 기본 출금 시점.
 * "이미 나갔다"가 틀리면 자금이 과대 계상되므로 보수적으로 deferred.
 */
const DEFAULT_TIMING: WithdrawalTiming = 'deferred';

export const PAYMENT_METHOD_OPTIONS = Object.keys(PAYMENT_METHODS);

/** 지출 폼·고정비 자동 기록의 기본 결제수단 */
export const DEFAULT_PAYMENT_METHOD = '현대카드';

export function getWithdrawalTiming(paymentMethod: string | null): WithdrawalTiming {
  if (!paymentMethod) return DEFAULT_TIMING;
  return PAYMENT_METHODS[paymentMethod]?.timing ?? DEFAULT_TIMING;
}

/** 즉시 출금 수단 목록 — SQL `= ANY($n)` 바인딩용 */
export const IMMEDIATE_PAYMENT_METHODS = Object.entries(PAYMENT_METHODS)
  .filter(([, spec]) => spec.timing === 'immediate')
  .map(([name]) => name);

/** 결제수단 문자열이 등록된 수단인지 */
export function isKnownPaymentMethod(value: string): boolean {
  return PAYMENT_METHODS[value] !== undefined;
}
