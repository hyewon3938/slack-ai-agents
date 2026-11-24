import { describe, it, expect } from 'vitest';
import {
  isNonNegativeInteger,
  isValidLimitCategory,
  isValidTargetCount,
  parseFixedCostCreate,
  parseFixedCostUpdate,
  parseIdParam,
  parseInstallmentMonths,
  validateExpenseFields,
  validatePlannedMemo,
} from '../validate-input';

// 합성 픽스처 — 금액은 지어낸 값

describe('parseIdParam', () => {
  it.each([
    ['1', 1],
    ['42', 42],
  ])('%s는 %s로 바꾼다', (raw, expected) => {
    expect(parseIdParam(raw)).toBe(expected);
  });

  it.each(['', '0', '-1', '1.5', '12abc', 'abc', ' 1', '1e3', '99999999999999999999'])(
    '%j는 null이다',
    (raw) => {
      expect(parseIdParam(raw)).toBeNull();
    },
  );

  it('null·undefined는 null이다', () => {
    expect(parseIdParam(null)).toBeNull();
    expect(parseIdParam(undefined)).toBeNull();
  });
});

describe('parseInstallmentMonths', () => {
  it.each([undefined, null, 1])('%s는 일시불(1)이다', (v) => {
    expect(parseInstallmentMonths(v)).toEqual({ data: 1 });
  });

  it.each([2, 6, 12])('%s개월은 그대로 쓴다', (v) => {
    expect(parseInstallmentMonths(v)).toEqual({ data: v });
  });

  it.each([0, -1, 13, 24, 2.5, '3', true])('%j는 에러다', (v) => {
    expect(parseInstallmentMonths(v)).toHaveProperty('error');
  });
});

describe('validateExpenseFields — create', () => {
  const base = { date: '2026-03-10', amount: 1000, category: '식재료' };

  it('정상 입력은 통과한다', () => {
    expect(validateExpenseFields(base, 'create')).toBeNull();
  });

  it.each([
    ['date 누락', { amount: 1000, category: '식재료' }],
    ['amount 누락', { date: '2026-03-10', category: '식재료' }],
    ['category 누락', { date: '2026-03-10', amount: 1000 }],
    ['소수 amount', { ...base, amount: 1000.5 }],
    ['숫자 description', { ...base, description: 3 }],
    ['숫자 payment_method', { ...base, payment_method: 1 }],
    ['소수 planned_expense_id', { ...base, planned_expense_id: 1.5 }],
    ['문자열 planned_expense_id', { ...base, planned_expense_id: '4' }],
  ])('%s는 에러다', (_label, body) => {
    expect(validateExpenseFields(body, 'create')).not.toBeNull();
  });

  it('payment_method가 null이면 기본값을 쓰도록 통과시킨다', () => {
    expect(validateExpenseFields({ ...base, payment_method: null }, 'create')).toBeNull();
  });
});

describe('validateExpenseFields — update', () => {
  it('보낸 필드만 본다 — 빈 본문도 통과한다', () => {
    expect(validateExpenseFields({}, 'update')).toBeNull();
  });

  it.each([
    ['소수 amount', { amount: 1000.5 }],
    ['0 amount', { amount: 0 }],
    ['숫자 category', { category: 3 }],
    ['null category', { category: null }],
    ['목록 밖 category', { category: '없는카테고리' }],
    ['숫자 date', { date: 20260310 }],
    ['null date', { date: null }],
    ['형식이 틀린 date', { date: '2026/03/10' }],
    ['null payment_method', { payment_method: null }],
    ['문자열 exclude_from_budget', { exclude_from_budget: 'true' }],
    ['숫자 distribute_to_budget', { distribute_to_budget: 1 }],
    ['수입 type에 지출 category', { type: 'income', category: '식재료' }],
  ])('%s는 에러다', (_label, body) => {
    expect(validateExpenseFields(body, 'update')).not.toBeNull();
  });

  it('type 없이 보낸 category는 전체 목록으로 본다', () => {
    expect(validateExpenseFields({ category: '수입' }, 'update')).toBeNull();
    expect(validateExpenseFields({ category: '식재료' }, 'update')).toBeNull();
  });

  it('description을 null로 지우고 planned_expense_id를 null로 끊는 것은 통과한다', () => {
    expect(validateExpenseFields({ description: null, planned_expense_id: null }, 'update')).toBeNull();
  });
});

describe('parseFixedCostCreate', () => {
  it('허용 필드만 남기고 이름 앞뒤 공백을 지운다', () => {
    expect(
      parseFixedCostCreate({ name: ' 통신비 ', amount: 1000, day_of_month: 5, user_id: 99, active: false }),
    ).toEqual({
      data: {
        name: '통신비',
        amount: 1000,
        category: undefined,
        day_of_month: 5,
        payment_method: undefined,
      },
    });
  });

  it.each([
    ['이름 누락', { amount: 1000 }],
    ['빈 이름', { name: '  ', amount: 1000 }],
    ['금액 누락', { name: '통신비' }],
    ['0 금액', { name: '통신비', amount: 0 }],
    ['소수 금액', { name: '통신비', amount: 1000.5 }],
    ['결제일 0', { name: '통신비', amount: 1000, day_of_month: 0 }],
    ['결제일 32', { name: '통신비', amount: 1000, day_of_month: 32 }],
    ['소수 결제일', { name: '통신비', amount: 1000, day_of_month: 1.5 }],
    ['등록되지 않은 결제수단', { name: '통신비', amount: 1000, payment_method: '없는카드' }],
    ['숫자 category', { name: '통신비', amount: 1000, category: 3 }],
    ['null 본문', null],
  ])('%s는 에러다', (_label, body) => {
    expect(parseFixedCostCreate(body)).toHaveProperty('error');
  });
});

describe('parseFixedCostUpdate', () => {
  it('허용 필드만 남긴다', () => {
    expect(
      parseFixedCostUpdate({ amount: 2000, day_of_month: null, payment_method: '현금', user_id: 99, id: 1 }),
    ).toEqual({ data: { amount: 2000, day_of_month: null, payment_method: '현금' } });
  });

  it('nullable 컬럼은 null로 지울 수 있다', () => {
    expect(parseFixedCostUpdate({ category: null, memo: null, payment_method: null })).toEqual({
      data: { category: null, memo: null, payment_method: null },
    });
  });

  it.each([
    ['null 금액', { amount: null }],
    ['null 이름', { name: null }],
    ['null active', { active: null }],
    ['문자열 is_variable', { is_variable: 'true' }],
    ['소수 결제일', { day_of_month: 2.5 }],
    ['허용 필드가 없는 본문', { user_id: 99 }],
    ['빈 본문', {}],
  ])('%s는 에러다', (_label, body) => {
    expect(parseFixedCostUpdate(body)).toHaveProperty('error');
  });
});

describe('isNonNegativeInteger', () => {
  it('0과 양의 정수만 참이다', () => {
    expect(isNonNegativeInteger(0)).toBe(true);
    expect(isNonNegativeInteger(1000)).toBe(true);
    expect(isNonNegativeInteger(-1)).toBe(false);
    expect(isNonNegativeInteger(1000.5)).toBe(false);
    expect(isNonNegativeInteger('1000')).toBe(false);
  });
});

describe('validatePlannedMemo', () => {
  it('문자열·null·생략은 통과한다', () => {
    expect(validatePlannedMemo('여행')).toBeNull();
    expect(validatePlannedMemo(null)).toBeNull();
    expect(validatePlannedMemo(undefined)).toBeNull();
  });

  it('문자열이 아니거나 200자를 넘으면 에러다', () => {
    expect(validatePlannedMemo(3)).not.toBeNull();
    expect(validatePlannedMemo('가'.repeat(201))).not.toBeNull();
  });
});

describe('카테고리 한도 입력', () => {
  it('target_count는 1~50 정수만 받는다', () => {
    expect(isValidTargetCount(1)).toBe(true);
    expect(isValidTargetCount(50)).toBe(true);
    expect(isValidTargetCount(0)).toBe(false);
    expect(isValidTargetCount(51)).toBe(false);
    expect(isValidTargetCount(2.5)).toBe(false);
    expect(isValidTargetCount('3')).toBe(false);
  });

  it('category는 지출 카테고리만 받는다', () => {
    expect(isValidLimitCategory('식재료')).toBe(true);
    expect(isValidLimitCategory('수입')).toBe(false);
    expect(isValidLimitCategory(3)).toBe(false);
  });
});
