import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/features/routine/lib/queries', () => ({
  deleteFreeRecord: vi.fn(),
  toggleRoutineRecord: vi.fn(),
  updateRoutineRecordMemo: vi.fn(),
}));

import { requireAuth } from '@/lib/auth';
import { toggleRoutineRecord, updateRoutineRecordMemo } from '@/features/routine/lib/queries';
import { PATCH } from '../route';
import { idParams, jsonRequest } from '@/app/api/__tests__/route-helpers';

const USER_ID = 7;
const PATH = '/api/routines/records/12';

const patch = (body: unknown, id = '12'): Promise<Response> =>
  PATCH(jsonRequest('PATCH', PATH, body), idParams(id));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(USER_ID);
});

describe('PATCH /api/routines/records/[id]', () => {
  it('로그인하지 않았으면 401이고 수정하지 않는다', async () => {
    vi.mocked(requireAuth).mockResolvedValue(null);

    const res = await patch({ completed: true });

    expect(res.status).toBe(401);
    expect(toggleRoutineRecord).not.toHaveBeenCalled();
  });

  it('경로 id가 양의 정수가 아니면 400이다', async () => {
    const res = await patch({ completed: true }, 'abc');

    expect(res.status).toBe(400);
    expect(toggleRoutineRecord).not.toHaveBeenCalled();
  });

  // 'false' 같은 문자열은 truthy라 완료 시각이 찍힌 미완료 기록이 될 수 있다
  it.each(['false', 'true', 1, 0, null, {}])('completed %s는 boolean이 아니라 400이다', async (completed) => {
    const res = await patch({ completed, memo: '메모' });

    expect(res.status).toBe(400);
    expect(toggleRoutineRecord).not.toHaveBeenCalled();
    expect(updateRoutineRecordMemo).not.toHaveBeenCalled();
  });

  it.each([true, false])('completed %s는 그대로 토글한다', async (completed) => {
    const res = await patch({ completed });

    expect(res.status).toBe(200);
    expect(toggleRoutineRecord).toHaveBeenCalledWith(USER_ID, 12, completed);
    expect(await res.json()).toEqual({ data: { id: 12 } });
  });

  it('completed 없이 메모만 보내면 메모만 수정한다', async () => {
    const res = await patch({ memo: '메모' });

    expect(res.status).toBe(200);
    expect(toggleRoutineRecord).not.toHaveBeenCalled();
    expect(updateRoutineRecordMemo).toHaveBeenCalledWith(USER_ID, 12, '메모');
  });
});
