import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/features/schedule/lib/queries', () => ({
  createCategory: vi.fn(),
  queryCategories: vi.fn(),
}));

import { requireAuth } from '@/lib/auth';
import { createCategory, queryCategories } from '@/features/schedule/lib/queries';
import type { CategoryRow } from '@/lib/types';
import { POST } from '../route';
import { jsonRequest } from '@/app/api/__tests__/route-helpers';

const USER_ID = 7;
const PATH = '/api/categories';

// 합성 픽스처 (실제 개인 데이터 아님)
const CREATED: CategoryRow = {
  id: 5,
  name: '운동',
  color: 'gray',
  type: 'task',
  sort_order: 1,
  parent_id: null,
};

// 본인 카테고리 목록: 3은 최상위, 4는 3의 하위
const OWN_CATEGORIES: CategoryRow[] = [
  { id: 3, name: '운동', color: 'gray', type: 'task', sort_order: 1, parent_id: null },
  { id: 4, name: '러닝', color: 'gray', type: null, sort_order: 1, parent_id: 3 },
];

const post = (body: unknown): Promise<Response> => POST(jsonRequest('POST', PATH, body));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(USER_ID);
  vi.mocked(createCategory).mockResolvedValue(CREATED);
  vi.mocked(queryCategories).mockResolvedValue(OWN_CATEGORIES);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('POST /api/categories — 입력 검증', () => {
  it('로그인하지 않았으면 401이고 만들지 않는다', async () => {
    vi.mocked(requireAuth).mockResolvedValue(null);

    const res = await post({ name: '운동' });

    expect(res.status).toBe(401);
    expect(createCategory).not.toHaveBeenCalled();
  });

  it.each([undefined, '', '   ', 123])('이름 %s는 400이다', async (name) => {
    const res = await post({ name });

    expect(res.status).toBe(400);
    expect(createCategory).not.toHaveBeenCalled();
  });

  it.each(['', 'habit', 0, false, null])('type %s는 허용 목록 밖이라 400이다', async (type) => {
    const res = await post({ name: '운동', type });

    expect(res.status).toBe(400);
    expect(createCategory).not.toHaveBeenCalled();
  });

  it('type을 보내지 않으면 기본값을 쓰도록 그대로 넘긴다', async () => {
    const res = await post({ name: '운동' });

    expect(res.status).toBe(201);
    expect(createCategory).toHaveBeenCalledWith(USER_ID, {
      name: '운동',
      color: undefined,
      type: undefined,
      parent_id: null,
    });
  });
});

describe('POST /api/categories — 상위 카테고리', () => {
  it.each(['3', 0, -1, 1.5, true])('parent_id %s는 양의 정수가 아니라 400이다', async (parentId) => {
    const res = await post({ name: '러닝', parent_id: parentId });

    expect(res.status).toBe(400);
    expect(queryCategories).not.toHaveBeenCalled();
    expect(createCategory).not.toHaveBeenCalled();
  });

  it('본인 카테고리가 아닌 상위는 400이고 만들지 않는다', async () => {
    const res = await post({ name: '러닝', parent_id: 99 });

    expect(res.status).toBe(400);
    expect(queryCategories).toHaveBeenCalledWith(USER_ID);
    expect(createCategory).not.toHaveBeenCalled();
  });

  it('하위 카테고리를 상위로 지정하면 두 단계를 넘으므로 400이고 만들지 않는다', async () => {
    const res = await post({ name: '인터벌', parent_id: 4 });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: '하위 카테고리 아래에는 만들 수 없어' });
    expect(createCategory).not.toHaveBeenCalled();
  });

  it('본인 상위 카테고리 아래에는 만든다', async () => {
    const res = await post({ name: '러닝', parent_id: 3 });

    expect(res.status).toBe(201);
    expect(createCategory).toHaveBeenCalledWith(USER_ID, expect.objectContaining({ parent_id: 3 }));
  });
});

describe('POST /api/categories — 실패 응답', () => {
  it('중복 이름은 409다', async () => {
    vi.mocked(createCategory).mockRejectedValue(new Error('duplicate key value'));

    const res = await post({ name: '운동' });

    expect(res.status).toBe(409);
  });

  it('그 밖의 오류는 고정 문구로 500을 돌려주고 원인은 로그로만 남긴다', async () => {
    vi.mocked(createCategory).mockRejectedValue(new Error('relation "categories" does not exist'));

    const res = await post({ name: '운동' });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: '카테고리 생성 실패' });
    expect(console.error).toHaveBeenCalled();
  });
});
