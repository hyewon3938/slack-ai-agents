import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/features/budget/lib/queries', () => ({
  updateFixedCost: vi.fn(),
  deleteFixedCost: vi.fn(),
}));

import { requireAuth } from '@/lib/auth';
import { deleteFixedCost, updateFixedCost } from '@/features/budget/lib/queries';
import { DELETE, PATCH } from '../route';
import { idParams, jsonRequest } from '@/app/api/__tests__/route-helpers';

const USER_ID = 7;

const patch = (body: unknown, id = '5'): Promise<Response> =>
  PATCH(jsonRequest('PATCH', `/api/budget/fixed-costs/${id}`, body), idParams(id));

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(requireAuth).mockResolvedValue(USER_ID);
});

describe('PATCH /api/budget/fixed-costs/[id]', () => {
  it('화면이 보내는 필드는 그대로 넘긴다', async () => {
    vi.mocked(updateFixedCost).mockResolvedValue({ id: 5 } as never);

    const res = await patch({ amount: 2000, day_of_month: null, payment_method: '현금' });

    expect(res.status).toBe(200);
    expect(updateFixedCost).toHaveBeenCalledWith(USER_ID, 5, {
      amount: 2000,
      day_of_month: null,
      payment_method: '현금',
    });
  });

  it('허용 필드 밖의 키는 넘기지 않는다', async () => {
    vi.mocked(updateFixedCost).mockResolvedValue({ id: 5 } as never);

    await patch({ amount: 2000, user_id: 99, id: 1, created_at: '2026-01-01' });

    expect(updateFixedCost).toHaveBeenCalledWith(USER_ID, 5, { amount: 2000 });
  });

  it.each([
    ['0 금액', { amount: 0 }],
    ['음수 금액', { amount: -1000 }],
    ['소수 금액', { amount: 1000.5 }],
    ['null 금액', { amount: null }],
    ['결제일 0', { day_of_month: 0 }],
    ['결제일 32', { day_of_month: 32 }],
    ['소수 결제일', { day_of_month: 2.5 }],
    ['문자열 결제일', { day_of_month: '5' }],
    ['빈 이름', { name: '' }],
    ['문자열 active', { active: 'false' }],
    ['등록되지 않은 결제수단', { payment_method: '없는카드' }],
    ['허용 필드가 없는 본문', { user_id: 99 }],
  ])('%s는 400이고 수정하지 않는다', async (_label, body) => {
    const res = await patch(body);

    expect(res.status).toBe(400);
    expect(updateFixedCost).not.toHaveBeenCalled();
  });

  it.each(['abc', '1.5', '0'])('id가 %s이면 400이다', async (rawId) => {
    const res = await patch({ amount: 1000 }, rawId);

    expect(res.status).toBe(400);
    expect(updateFixedCost).not.toHaveBeenCalled();
  });

  it('대상이 없으면 404다', async () => {
    vi.mocked(updateFixedCost).mockResolvedValue(null);

    const res = await patch({ amount: 1000 });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/budget/fixed-costs/[id]', () => {
  it.each(['abc', '1.5', '0'])('id가 %s이면 400이다', async (rawId) => {
    const res = await DELETE(
      jsonRequest('DELETE', `/api/budget/fixed-costs/${rawId}`),
      idParams(rawId),
    );

    expect(res.status).toBe(400);
    expect(deleteFixedCost).not.toHaveBeenCalled();
  });
});
