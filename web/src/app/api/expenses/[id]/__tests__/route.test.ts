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
  };
});

import { requireAuth } from '@/lib/auth';
import { updateExpense, FIXED_SOURCE_EXCLUDE_LOCKED } from '@/features/budget/lib/queries';
import { PATCH } from '../route';
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
