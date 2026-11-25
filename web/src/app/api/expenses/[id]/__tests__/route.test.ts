import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/features/budget/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/budget/lib/queries')>();
  return {
    FIXED_SOURCE_EXCLUDE_LOCKED: actual.FIXED_SOURCE_EXCLUDE_LOCKED,
    updateExpense: vi.fn(),
    deleteExpense: vi.fn(),
    isPlannedExpenseOwned: vi.fn(),
  };
});

import { requireAuth } from '@/lib/auth';
import {
  deleteExpense,
  isPlannedExpenseOwned,
  updateExpense,
  FIXED_SOURCE_EXCLUDE_LOCKED,
} from '@/features/budget/lib/queries';
import { DELETE, PATCH } from '../route';
import { idParams, jsonRequest } from '@/app/api/__tests__/route-helpers';

const patch = (body: unknown): Promise<Response> =>
  PATCH(jsonRequest('PATCH', '/api/expenses/3', body), idParams('3'));

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(requireAuth).mockResolvedValue(7);
});

describe('PATCH /api/expenses/[id]', () => {
  it('자동 등록 고정비의 예산 제외를 바꾸려 하면 400이다', async () => {
    vi.mocked(updateExpense).mockRejectedValue(new Error(FIXED_SOURCE_EXCLUDE_LOCKED));

    const res = await patch({ exclude_from_budget: true });

    expect(res.status).toBe(400);
    expect(updateExpense).toHaveBeenCalledWith(7, 3, { exclude_from_budget: true });
  });

  it('그 밖의 수정 실패는 500이다', async () => {
    vi.mocked(updateExpense).mockRejectedValue(new Error('db error'));

    const res = await patch({ exclude_from_budget: true });

    expect(res.status).toBe(500);
  });

  it('boolean이 아닌 exclude_from_budget은 400이고 수정하지 않는다', async () => {
    const res = await patch({ exclude_from_budget: 'true' });

    expect(res.status).toBe(400);
    expect(updateExpense).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/expenses/[id] — 필드 검증 (POST와 같은 기준)', () => {
  it.each([
    ['소수 amount', { amount: 1000.5 }],
    ['0 amount', { amount: 0 }],
    ['숫자 category', { category: 3 }],
    ['null category', { category: null }],
    ['목록 밖 category', { category: '없는카테고리' }],
    ['숫자 date', { date: 20260310 }],
    ['null date', { date: null }],
    ['형식이 틀린 date', { date: '2026/03/10' }],
  ])('%s는 400이고 수정하지 않는다', async (_label, body) => {
    const res = await patch(body);

    expect(res.status).toBe(400);
    expect(updateExpense).not.toHaveBeenCalled();
  });

  it('본문이 배열이면 400이다', async () => {
    const res = await patch([1, 2]);

    expect(res.status).toBe(400);
    expect(updateExpense).not.toHaveBeenCalled();
  });

  it('바르게 보낸 필드는 그대로 넘긴다', async () => {
    vi.mocked(updateExpense).mockResolvedValue({ id: 3 } as never);

    const res = await patch({ amount: 2000, category: '식재료', date: '2026-03-11' });

    expect(res.status).toBe(200);
    expect(updateExpense).toHaveBeenCalledWith(7, 3, {
      amount: 2000,
      category: '식재료',
      date: '2026-03-11',
    });
  });
});

describe('PATCH /api/expenses/[id] — id와 예정 지출 연결', () => {
  it.each(['abc', '1.5', '0', '-1', '3abc'])('id가 %s이면 400이다', async (rawId) => {
    const res = await PATCH(
      jsonRequest('PATCH', `/api/expenses/${rawId}`, { amount: 1000 }),
      idParams(rawId),
    );

    expect(res.status).toBe(400);
    expect(updateExpense).not.toHaveBeenCalled();
  });

  it('내 예정 지출이 아니면 400이고 수정하지 않는다', async () => {
    vi.mocked(isPlannedExpenseOwned).mockResolvedValue(false);

    const res = await patch({ planned_expense_id: 4 });

    expect(res.status).toBe(400);
    expect(isPlannedExpenseOwned).toHaveBeenCalledWith(7, 4);
    expect(updateExpense).not.toHaveBeenCalled();
  });

  it('내 예정 지출이면 연결한다', async () => {
    vi.mocked(isPlannedExpenseOwned).mockResolvedValue(true);
    vi.mocked(updateExpense).mockResolvedValue({ id: 3 } as never);

    const res = await patch({ planned_expense_id: 4 });

    expect(res.status).toBe(200);
    expect(updateExpense).toHaveBeenCalledWith(7, 3, { planned_expense_id: 4 });
  });

  it('연결을 끊는 null은 소유 확인 없이 넘긴다', async () => {
    vi.mocked(updateExpense).mockResolvedValue({ id: 3 } as never);

    const res = await patch({ planned_expense_id: null });

    expect(res.status).toBe(200);
    expect(isPlannedExpenseOwned).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/expenses/[id]', () => {
  it.each(['abc', '1.5', '0'])('id가 %s이면 400이다', async (rawId) => {
    const res = await DELETE(jsonRequest('DELETE', `/api/expenses/${rawId}`), idParams(rawId));

    expect(res.status).toBe(400);
    expect(deleteExpense).not.toHaveBeenCalled();
  });
});
