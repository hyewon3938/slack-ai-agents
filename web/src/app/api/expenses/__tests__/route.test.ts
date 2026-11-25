import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/features/budget/lib/queries', () => ({
  queryExpenses: vi.fn(),
  queryExpensesByBillingMonth: vi.fn(),
  createExpense: vi.fn(),
  createInstallmentExpenses: vi.fn(),
}));

import { requireAuth } from '@/lib/auth';
import { createExpense, createInstallmentExpenses } from '@/features/budget/lib/queries';
import { POST } from '../route';
import { jsonRequest } from '@/app/api/__tests__/route-helpers';

const USER_ID = 7;

// 합성 픽스처 — 지어낸 금액
const BASE_BODY = {
  date: '2026-03-10',
  amount: 1000,
  category: '식재료',
  payment_method: '현금',
};

const post = (body: unknown): Promise<Response> => POST(jsonRequest('POST', '/api/expenses', body));

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(requireAuth).mockResolvedValue(USER_ID);
});

describe('POST /api/expenses — 검증', () => {
  it('로그인하지 않았으면 401이고 저장하지 않는다', async () => {
    vi.mocked(requireAuth).mockResolvedValue(null);

    const res = await post(BASE_BODY);

    expect(res.status).toBe(401);
    expect(createExpense).not.toHaveBeenCalled();
  });

  it.each([
    ['0', 0],
    ['음수', -1000],
    ['소수', 1000.5],
    ['문자열', '1000'],
  ])('amount가 %s이면 400이고 저장하지 않는다', async (_label, amount) => {
    const res = await post({ ...BASE_BODY, amount });

    expect(res.status).toBe(400);
    expect(createExpense).not.toHaveBeenCalled();
    expect(createInstallmentExpenses).not.toHaveBeenCalled();
  });

  it('date 형식이 틀리면 400이다', async () => {
    const res = await post({ ...BASE_BODY, date: '2026/03/10' });

    expect(res.status).toBe(400);
    expect(createExpense).not.toHaveBeenCalled();
  });

  it('expense도 income도 아닌 type은 400이다', async () => {
    const res = await post({ ...BASE_BODY, type: 'transfer' });

    expect(res.status).toBe(400);
    expect(createExpense).not.toHaveBeenCalled();
  });

  it('지출에 수입 카테고리를 쓰면 400이다', async () => {
    const res = await post({ ...BASE_BODY, category: '수입' });

    expect(res.status).toBe(400);
    expect(createExpense).not.toHaveBeenCalled();
  });

  it('수입에 지출 카테고리를 쓰면 400이다', async () => {
    const res = await post({ ...BASE_BODY, type: 'income', category: '식재료' });

    expect(res.status).toBe(400);
    expect(createExpense).not.toHaveBeenCalled();
  });

  it('수입은 수입 카테고리로 저장한다', async () => {
    const res = await post({ ...BASE_BODY, type: 'income', category: '수입', amount: 2000 });

    expect(res.status).toBe(201);
    expect(createExpense).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ type: 'income', category: '수입', amount: 2000 }),
    );
  });
});

describe('POST /api/expenses — 일시불과 할부', () => {
  it('할부 개월이 없으면 일시불로 저장하고 예산 제외 값은 기본 false다', async () => {
    const res = await post(BASE_BODY);

    expect(res.status).toBe(201);
    expect(createInstallmentExpenses).not.toHaveBeenCalled();
    expect(createExpense).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({
        amount: 1000,
        type: 'expense',
        exclude_from_budget: false,
        distribute_to_budget: false,
        planned_expense_id: null,
      }),
    );
  });

  it('boolean이 아닌 exclude_from_budget은 false로 저장한다', async () => {
    await post({ ...BASE_BODY, exclude_from_budget: 'yes' });

    expect(createExpense).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ exclude_from_budget: false }),
    );
  });

  it.each([2, 12])('할부 %s개월은 할부 생성으로 저장한다', async (months) => {
    const res = await post({ ...BASE_BODY, amount: 12000, installment_months: months });

    expect(res.status).toBe(201);
    expect(createExpense).not.toHaveBeenCalled();
    expect(createInstallmentExpenses).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ totalAmount: 12000, months, date: '2026-03-10', type: 'expense' }),
    );
  });

  it('할부로 저장할 때는 예산 제외 값을 넘기지 않는다', async () => {
    await post({ ...BASE_BODY, installment_months: 3, exclude_from_budget: true });

    const [, input] = vi.mocked(createInstallmentExpenses).mock.calls[0];
    expect(input).not.toHaveProperty('exclude_from_budget');
  });

  it('할부 1개월은 일시불로 저장한다', async () => {
    await post({ ...BASE_BODY, installment_months: 1 });

    expect(createInstallmentExpenses).not.toHaveBeenCalled();
    expect(createExpense).toHaveBeenCalledTimes(1);
  });
});
