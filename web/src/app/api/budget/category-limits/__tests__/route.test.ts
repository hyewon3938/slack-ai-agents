import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/features/budget/lib/repository/category-limits-repo', () => ({
  readCategoryLimitsWithUsage: vi.fn(),
  createCategoryLimit: vi.fn(),
  updateCategoryLimit: vi.fn(),
  deleteCategoryLimit: vi.fn(),
}));

import { requireAuth } from '@/lib/auth';
import {
  createCategoryLimit,
  deleteCategoryLimit,
  updateCategoryLimit,
} from '@/features/budget/lib/repository/category-limits-repo';
import { POST } from '../route';
import { DELETE, PATCH } from '../[id]/route';
import { idParams, jsonRequest } from '@/app/api/__tests__/route-helpers';

const USER_ID = 7;
const PATH = '/api/budget/category-limits';

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(requireAuth).mockResolvedValue(USER_ID);
});

describe('POST /api/budget/category-limits', () => {
  it('지출 카테고리와 정수 한도는 저장한다', async () => {
    vi.mocked(createCategoryLimit).mockResolvedValue({ id: 1 } as never);

    const res = await POST(jsonRequest('POST', PATH, { category: '식재료', target_count: 3 }));

    expect(res.status).toBe(201);
    expect(createCategoryLimit).toHaveBeenCalledWith(USER_ID, { category: '식재료', target_count: 3 });
  });

  it.each([
    ['숫자 category', { category: 3, target_count: 3 }],
    ['목록 밖 category', { category: '없는카테고리', target_count: 3 }],
    ['수입 category', { category: '수입', target_count: 3 }],
    ['소수 한도', { category: '식재료', target_count: 2.5 }],
    ['51 한도', { category: '식재료', target_count: 51 }],
  ])('%s는 400이고 저장하지 않는다', async (_label, body) => {
    const res = await POST(jsonRequest('POST', PATH, body));

    expect(res.status).toBe(400);
    expect(createCategoryLimit).not.toHaveBeenCalled();
  });

  it('중복이면 409이고 DB 메시지는 내보내지 않는다', async () => {
    vi.mocked(createCategoryLimit).mockRejectedValue(
      new Error('duplicate key value violates unique constraint "category_limits_pkey"'),
    );

    const res = await POST(jsonRequest('POST', PATH, { category: '식재료', target_count: 3 }));
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(409);
    expect(body.error).not.toContain('constraint');
  });
});

describe('PATCH·DELETE /api/budget/category-limits/[id]', () => {
  it.each(['abc', '1.5', '0'])('PATCH id가 %s이면 400이다', async (rawId) => {
    const res = await PATCH(
      jsonRequest('PATCH', `${PATH}/${rawId}`, { target_count: 3 }),
      idParams(rawId),
    );

    expect(res.status).toBe(400);
    expect(updateCategoryLimit).not.toHaveBeenCalled();
  });

  it('소수 한도는 400이다', async () => {
    const res = await PATCH(jsonRequest('PATCH', `${PATH}/4`, { target_count: 2.5 }), idParams('4'));

    expect(res.status).toBe(400);
    expect(updateCategoryLimit).not.toHaveBeenCalled();
  });

  it('정수 한도는 수정한다', async () => {
    vi.mocked(updateCategoryLimit).mockResolvedValue({ id: 4 } as never);

    const res = await PATCH(jsonRequest('PATCH', `${PATH}/4`, { target_count: 5 }), idParams('4'));

    expect(res.status).toBe(200);
    expect(updateCategoryLimit).toHaveBeenCalledWith(USER_ID, 4, { target_count: 5 });
  });

  it.each(['abc', '1.5', '0'])('DELETE id가 %s이면 400이다', async (rawId) => {
    const res = await DELETE(jsonRequest('DELETE', `${PATH}/${rawId}`), idParams(rawId));

    expect(res.status).toBe(400);
    expect(deleteCategoryLimit).not.toHaveBeenCalled();
  });
});
