import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/features/budget/lib/queries', () => ({
  queryExpenses: vi.fn(),
  queryExpensesByBillingMonth: vi.fn(),
  createExpense: vi.fn(),
  createInstallmentExpenses: vi.fn(),
  isPlannedExpenseOwned: vi.fn(),
}));

import { requireAuth } from '@/lib/auth';
import {
  createExpense,
  createInstallmentExpenses,
  isPlannedExpenseOwned,
  queryExpenses,
} from '@/features/budget/lib/queries';
import { GET, POST } from '../route';
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

describe('POST /api/expenses — 할부 개월 범위', () => {
  it.each([
    ['0', 0],
    ['음수', -3],
    ['13', 13],
    ['24', 24],
    ['소수', 2.5],
    ['문자열', '3'],
  ])('installment_months가 %s이면 400이고 일시불로도 저장하지 않는다', async (_label, months) => {
    const res = await post({ ...BASE_BODY, installment_months: months });

    expect(res.status).toBe(400);
    expect(createExpense).not.toHaveBeenCalled();
    expect(createInstallmentExpenses).not.toHaveBeenCalled();
  });

  it('installment_months가 null이면 일시불로 저장한다', async () => {
    const res = await post({ ...BASE_BODY, installment_months: null });

    expect(res.status).toBe(201);
    expect(createExpense).toHaveBeenCalledTimes(1);
    expect(createInstallmentExpenses).not.toHaveBeenCalled();
  });
});

describe('POST /api/expenses — 예정 지출 연결', () => {
  it('내 예정 지출이 아니면 400이고 저장하지 않는다', async () => {
    vi.mocked(isPlannedExpenseOwned).mockResolvedValue(false);

    const res = await post({ ...BASE_BODY, planned_expense_id: 4 });

    expect(res.status).toBe(400);
    expect(isPlannedExpenseOwned).toHaveBeenCalledWith(USER_ID, 4);
    expect(createExpense).not.toHaveBeenCalled();
  });

  it('내 예정 지출이면 연결해서 저장한다', async () => {
    vi.mocked(isPlannedExpenseOwned).mockResolvedValue(true);

    const res = await post({ ...BASE_BODY, planned_expense_id: 4 });

    expect(res.status).toBe(201);
    expect(createExpense).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ planned_expense_id: 4 }),
    );
  });

  it('할부도 소유를 확인한 뒤에만 저장한다', async () => {
    vi.mocked(isPlannedExpenseOwned).mockResolvedValue(false);

    const res = await post({ ...BASE_BODY, installment_months: 3, planned_expense_id: 4 });

    expect(res.status).toBe(400);
    expect(createInstallmentExpenses).not.toHaveBeenCalled();
  });

  it('planned_expense_id가 정수가 아니면 조회 없이 400이다', async () => {
    const res = await post({ ...BASE_BODY, planned_expense_id: '4' });

    expect(res.status).toBe(400);
    expect(isPlannedExpenseOwned).not.toHaveBeenCalled();
    expect(createExpense).not.toHaveBeenCalled();
  });

  it('planned_expense_id가 없으면 소유 확인을 하지 않는다', async () => {
    await post(BASE_BODY);

    expect(isPlannedExpenseOwned).not.toHaveBeenCalled();
  });
});

describe('GET /api/expenses — planned_expense_id 필터', () => {
  it.each(['abc', '1.5', '0'])('planned_expense_id=%s는 400이다', async (raw) => {
    const res = await GET(jsonRequest('GET', `/api/expenses?planned_expense_id=${raw}`));

    expect(res.status).toBe(400);
    expect(queryExpenses).not.toHaveBeenCalled();
  });
});
