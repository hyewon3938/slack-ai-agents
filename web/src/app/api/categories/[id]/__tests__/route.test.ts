import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
}));

vi.mock('@/features/schedule/lib/queries', () => ({
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
}));

import { requireAuth } from '@/lib/auth';
import { updateCategory, deleteCategory } from '@/features/schedule/lib/queries';
import type { CategoryRow } from '@/lib/types';
import { DELETE, PATCH } from '../route';
import { idParams, jsonRequest } from '@/app/api/__tests__/route-helpers';

const USER_ID = 7;
const PATH = '/api/categories/3';

// 합성 픽스처 (실제 개인 데이터 아님)
const UPDATED: CategoryRow = {
  id: 3,
  name: '운동',
  color: 'gray',
  type: 'task',
  sort_order: 1,
  parent_id: null,
};

const patch = (body: unknown, id = '3'): Promise<Response> =>
  PATCH(jsonRequest('PATCH', PATH, body), idParams(id));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(USER_ID);
  vi.mocked(updateCategory).mockResolvedValue(UPDATED);
  vi.mocked(deleteCategory).mockResolvedValue(true);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('PATCH /api/categories/[id]', () => {
  it.each(['abc', '0', '3x'])('경로 id %s는 400이고 수정하지 않는다', async (id) => {
    const res = await patch({ name: '운동' }, id);

    expect(res.status).toBe(400);
    expect(updateCategory).not.toHaveBeenCalled();
  });

  it.each(['', '   ', 5])('이름 %s는 400이다', async (name) => {
    const res = await patch({ name });

    expect(res.status).toBe(400);
    expect(updateCategory).not.toHaveBeenCalled();
  });

  it('이름이 길이 제한을 넘으면 400이다', async () => {
    const res = await patch({ name: '가'.repeat(1000) });

    expect(res.status).toBe(400);
    expect(updateCategory).not.toHaveBeenCalled();
  });

  it.each(['', 'habit', null])('type %s는 허용 목록 밖이라 400이다', async (type) => {
    const res = await patch({ type });

    expect(res.status).toBe(400);
    expect(updateCategory).not.toHaveBeenCalled();
  });

  it('이름은 앞뒤 공백을 지워 user 스코프로 수정한다', async () => {
    const res = await patch({ name: '  운동  ', type: 'event' });

    expect(res.status).toBe(200);
    expect(updateCategory).toHaveBeenCalledWith(
      USER_ID,
      3,
      expect.objectContaining({ name: '운동', type: 'event' }),
    );
  });

  it('parent_id는 수정 대상으로 넘기지 않는다 (깊이는 생성 때만 정해진다)', async () => {
    const res = await patch({ name: '운동', parent_id: 4 });

    expect(res.status).toBe(200);
    const fields = vi.mocked(updateCategory).mock.calls[0]?.[2];
    expect(fields).not.toHaveProperty('parent_id');
  });

  it('그 밖의 오류는 고정 문구로 500을 돌려주고 원인은 로그로만 남긴다', async () => {
    vi.mocked(updateCategory).mockRejectedValue(new Error('connection terminated'));

    const res = await patch({ name: '운동' });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: '카테고리 수정 실패' });
    expect(console.error).toHaveBeenCalled();
  });
});

describe('DELETE /api/categories/[id]', () => {
  it('경로 id가 양의 정수가 아니면 400이고 삭제하지 않는다', async () => {
    const res = await DELETE(jsonRequest('DELETE', PATH), idParams('abc'));

    expect(res.status).toBe(400);
    expect(deleteCategory).not.toHaveBeenCalled();
  });

  it('삭제하면 숫자 id를 돌려준다', async () => {
    const res = await DELETE(jsonRequest('DELETE', PATH), idParams('3'));

    expect(deleteCategory).toHaveBeenCalledWith(USER_ID, 3);
    expect(await res.json()).toEqual({ data: { id: 3 } });
  });
});
