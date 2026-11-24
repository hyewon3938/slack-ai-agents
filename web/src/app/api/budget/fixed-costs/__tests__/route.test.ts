import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/features/budget/lib/queries', () => ({
  queryFixedCosts: vi.fn(),
  createFixedCost: vi.fn(),
}));

import { requireAuth } from '@/lib/auth';
import { createFixedCost } from '@/features/budget/lib/queries';
import { POST } from '../route';
import { jsonRequest } from '@/app/api/__tests__/route-helpers';

const USER_ID = 7;

// 합성 픽스처 — 지어낸 금액
const BASE_BODY = { name: '통신비', amount: 1000, day_of_month: 5, payment_method: '현금' };

const post = (body: unknown): Promise<Response> =>
  POST(jsonRequest('POST', '/api/budget/fixed-costs', body));

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(requireAuth).mockResolvedValue(USER_ID);
});

describe('POST /api/budget/fixed-costs', () => {
  it('허용 필드만 넘겨 저장한다', async () => {
    vi.mocked(createFixedCost).mockResolvedValue({ id: 1 } as never);

    const res = await post({ ...BASE_BODY, user_id: 99, active: false });

    expect(res.status).toBe(201);
    expect(createFixedCost).toHaveBeenCalledWith(USER_ID, {
      name: '통신비',
      amount: 1000,
      category: undefined,
      day_of_month: 5,
      payment_method: '현금',
    });
  });

  it.each([
    ['0 금액', { amount: 0 }],
    ['소수 금액', { amount: 1000.5 }],
    ['문자열 금액', { amount: '1000' }],
    ['결제일 0', { day_of_month: 0 }],
    ['결제일 32', { day_of_month: 32 }],
    ['소수 결제일', { day_of_month: 1.5 }],
    ['빈 이름', { name: ' ' }],
    ['등록되지 않은 결제수단', { payment_method: '없는카드' }],
  ])('%s는 400이고 저장하지 않는다', async (_label, override) => {
    const res = await post({ ...BASE_BODY, ...override });

    expect(res.status).toBe(400);
    expect(createFixedCost).not.toHaveBeenCalled();
  });

  it('로그인하지 않았으면 401이다', async () => {
    vi.mocked(requireAuth).mockResolvedValue(null);

    const res = await post(BASE_BODY);

    expect(res.status).toBe(401);
    expect(createFixedCost).not.toHaveBeenCalled();
  });
});
