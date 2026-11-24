import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/features/budget/lib/queries', () => ({
  updateAsset: vi.fn(),
  setDefaultAsset: vi.fn(),
  clearDefaultAsset: vi.fn(),
}));

import { requireAuth } from '@/lib/auth';
import { clearDefaultAsset, setDefaultAsset, updateAsset } from '@/features/budget/lib/queries';
import { PATCH } from '../route';
import { idParams, jsonRequest } from '@/app/api/__tests__/route-helpers';

const USER_ID = 7;

const patch = (body: unknown, id = '2'): Promise<Response> =>
  PATCH(jsonRequest('PATCH', `/api/budget/assets/${id}`, body), idParams(id));

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(requireAuth).mockResolvedValue(USER_ID);
});

describe('PATCH /api/budget/assets/[id]', () => {
  it('정수 잔액은 저장한다', async () => {
    vi.mocked(updateAsset).mockResolvedValue({ id: 2 } as never);

    const res = await patch({ balance: 1000, available_amount: 1000 });

    expect(res.status).toBe(200);
    expect(updateAsset).toHaveBeenCalledWith(
      USER_ID,
      2,
      expect.objectContaining({ balance: 1000, available_amount: 1000 }),
    );
  });

  it.each([
    ['소수 balance', { balance: 1000.5 }],
    ['음수 balance', { balance: -1 }],
    ['문자열 available_amount', { available_amount: '1000' }],
    ['소수 available_amount', { available_amount: 0.5 }],
    ['숫자 memo', { memo: 3 }],
    ['500자를 넘는 memo', { memo: '가'.repeat(501) }],
  ])('%s는 400이고 수정하지 않는다', async (_label, body) => {
    const res = await patch(body);

    expect(res.status).toBe(400);
    expect(updateAsset).not.toHaveBeenCalled();
  });

  it('boolean이 아닌 is_default는 400이고 기본 자산을 해제하지 않는다', async () => {
    const res = await patch({ is_default: 'false' });

    expect(res.status).toBe(400);
    expect(clearDefaultAsset).not.toHaveBeenCalled();
    expect(setDefaultAsset).not.toHaveBeenCalled();
  });

  it.each(['abc', '1.5', '2abc', '0'])('id가 %s이면 400이다', async (rawId) => {
    const res = await patch({ balance: 1000 }, rawId);

    expect(res.status).toBe(400);
    expect(updateAsset).not.toHaveBeenCalled();
  });
});
