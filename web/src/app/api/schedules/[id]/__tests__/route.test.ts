import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/features/schedule/lib/queries', () => ({
  queryScheduleById: vi.fn(),
  updateSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
  recordDeleteReason: vi.fn(),
  validateCategoryOwnership: vi.fn(),
}));

import { requireAuth } from '@/lib/auth';
import {
  updateSchedule,
  deleteSchedule,
  recordDeleteReason,
  validateCategoryOwnership,
} from '@/features/schedule/lib/queries';
import type { ScheduleRow } from '@/features/schedule/lib/types';
import { DELETE, PATCH } from '../route';
import { idParams, jsonRequest, rawRequest } from '@/app/api/__tests__/route-helpers';

const USER_ID = 7;
const PATH = '/api/schedules/42';

const SCHEDULE_ROW: ScheduleRow = {
  id: 42,
  title: '테스트 일정',
  date: '2026-01-10',
  end_date: null,
  status: 'todo',
  category_id: null,
  memo: null,
  important: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(USER_ID);
  vi.mocked(deleteSchedule).mockResolvedValue(true);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('DELETE /api/schedules/[id]', () => {
  it('로그인하지 않았으면 401이고 삭제하지 않는다', async () => {
    vi.mocked(requireAuth).mockResolvedValue(null);

    const res = await DELETE(jsonRequest('DELETE', PATH), idParams('42'));

    expect(res.status).toBe(401);
    expect(deleteSchedule).not.toHaveBeenCalled();
  });

  it('본문이 없으면 사유 없이 삭제한다', async () => {
    const res = await DELETE(jsonRequest('DELETE', PATH), idParams('42'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { id: 42 } });
    expect(deleteSchedule).toHaveBeenCalledWith(USER_ID, 42);
    expect(recordDeleteReason).not.toHaveBeenCalled();
  });

  it('본문이 JSON이 아니어도 사유 없이 삭제한다', async () => {
    const res = await DELETE(rawRequest('DELETE', PATH, '{not json'), idParams('42'));

    expect(res.status).toBe(200);
    expect(deleteSchedule).toHaveBeenCalledWith(USER_ID, 42);
    expect(recordDeleteReason).not.toHaveBeenCalled();
  });

  it('정해진 어휘가 아닌 사유 카테고리는 400이고 삭제하지 않는다', async () => {
    const res = await DELETE(
      jsonRequest('DELETE', PATH, { reason_category: 'whatever' }),
      idParams('42'),
    );

    expect(res.status).toBe(400);
    expect(deleteSchedule).not.toHaveBeenCalled();
  });

  it('사유 텍스트는 앞뒤 공백을 지워 기록한다', async () => {
    await DELETE(
      jsonRequest('DELETE', PATH, { reason_category: 'external', reason_text: '  비 와서  ' }),
      idParams('42'),
    );

    expect(recordDeleteReason).toHaveBeenCalledWith(USER_ID, 42, 'external', '비 와서');
  });

  it('공백뿐인 사유 텍스트는 null로 기록한다', async () => {
    await DELETE(
      jsonRequest('DELETE', PATH, { reason_category: 'mistake', reason_text: '   ' }),
      idParams('42'),
    );

    expect(recordDeleteReason).toHaveBeenCalledWith(USER_ID, 42, 'mistake', null);
  });

  it('사유 텍스트가 300자를 넘으면 400이고 삭제하지 않는다', async () => {
    const res = await DELETE(
      jsonRequest('DELETE', PATH, { reason_category: 'other', reason_text: 'a'.repeat(301) }),
      idParams('42'),
    );

    expect(res.status).toBe(400);
    expect(deleteSchedule).not.toHaveBeenCalled();
  });

  it('사유 기록이 실패해도 삭제 성공으로 응답한다', async () => {
    vi.mocked(recordDeleteReason).mockRejectedValue(new Error('insert failed'));

    const res = await DELETE(
      jsonRequest('DELETE', PATH, { reason_category: 'changed_mind' }),
      idParams('42'),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { id: 42 } });
  });

  it('삭제할 일정이 없으면 404이고 사유를 기록하지 않는다', async () => {
    vi.mocked(deleteSchedule).mockResolvedValue(false);

    const res = await DELETE(
      jsonRequest('DELETE', PATH, { reason_category: 'mistake' }),
      idParams('42'),
    );

    expect(res.status).toBe(404);
    expect(recordDeleteReason).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/schedules/[id]', () => {
  it('로그인하지 않았으면 401이고 수정하지 않는다', async () => {
    vi.mocked(requireAuth).mockResolvedValue(null);

    const res = await PATCH(jsonRequest('PATCH', PATH, { title: '수정' }), idParams('42'));

    expect(res.status).toBe(401);
    expect(updateSchedule).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5])('category_id가 %s이면 400이고 소유 확인도 하지 않는다', async (categoryId) => {
    const res = await PATCH(
      jsonRequest('PATCH', PATH, { category_id: categoryId }),
      idParams('42'),
    );

    expect(res.status).toBe(400);
    expect(validateCategoryOwnership).not.toHaveBeenCalled();
    expect(updateSchedule).not.toHaveBeenCalled();
  });

  it('본인 소유가 아닌 카테고리면 400이고 수정하지 않는다', async () => {
    vi.mocked(validateCategoryOwnership).mockResolvedValue(false);

    const res = await PATCH(jsonRequest('PATCH', PATH, { category_id: 3 }), idParams('42'));

    expect(res.status).toBe(400);
    expect(validateCategoryOwnership).toHaveBeenCalledWith(USER_ID, 3);
    expect(updateSchedule).not.toHaveBeenCalled();
  });

  it('category_id가 null이면 소유 확인 없이 카테고리 해제로 수정한다', async () => {
    vi.mocked(updateSchedule).mockResolvedValue(SCHEDULE_ROW);

    const res = await PATCH(jsonRequest('PATCH', PATH, { category_id: null }), idParams('42'));

    expect(res.status).toBe(200);
    expect(validateCategoryOwnership).not.toHaveBeenCalled();
    expect(updateSchedule).toHaveBeenCalledWith(USER_ID, 42, { category_id: null });
  });

  it('유효하지 않은 상태값은 400이고 수정하지 않는다', async () => {
    const res = await PATCH(jsonRequest('PATCH', PATH, { status: 'archived' }), idParams('42'));

    expect(res.status).toBe(400);
    expect(updateSchedule).not.toHaveBeenCalled();
  });

  it('수정할 일정이 없으면 404', async () => {
    vi.mocked(updateSchedule).mockResolvedValue(null);

    const res = await PATCH(jsonRequest('PATCH', PATH, { title: '수정' }), idParams('42'));

    expect(res.status).toBe(404);
  });
});
