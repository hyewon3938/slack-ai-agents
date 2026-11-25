import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/features/routine/lib/queries', () => ({
  queryInactivePeriods: vi.fn(),
  createInactivePeriod: vi.fn(),
  queryRoutineTemplate: vi.fn(),
}));

import { requireAuth } from '@/lib/auth';
import {
  queryInactivePeriods,
  createInactivePeriod,
  queryRoutineTemplate,
} from '@/features/routine/lib/queries';
import type { RoutineInactivePeriod, RoutineTemplateRow } from '@/features/routine/lib/types';
import { GET, POST } from '../route';
import { idParams, jsonRequest } from '@/app/api/__tests__/route-helpers';

const USER_ID = 7;
const PATH = '/api/routines/9/inactive-periods';

// 합성 픽스처 (실제 개인 데이터 아님)
const TEMPLATE: RoutineTemplateRow = {
  id: 9,
  name: '물 마시기',
  time_slot: '낮',
  frequency: '매일',
  active: true,
  tracking_mode: 'scheduled',
};

const PERIOD: RoutineInactivePeriod = {
  id: 1,
  template_id: 9,
  start_date: '2026-03-01',
  end_date: '2026-03-05',
};

const post = (body: unknown, id = '9'): Promise<Response> =>
  POST(jsonRequest('POST', PATH, body), idParams(id));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(USER_ID);
  vi.mocked(queryRoutineTemplate).mockResolvedValue(TEMPLATE);
  vi.mocked(createInactivePeriod).mockResolvedValue(PERIOD);
  vi.mocked(queryInactivePeriods).mockResolvedValue([PERIOD]);
});

describe('POST /api/routines/[id]/inactive-periods', () => {
  it('본인 루틴이 아니면 404이고 기간을 만들지 않는다', async () => {
    vi.mocked(queryRoutineTemplate).mockResolvedValue(null);

    const res = await post({ start_date: '2026-03-01', end_date: null });

    expect(res.status).toBe(404);
    expect(queryRoutineTemplate).toHaveBeenCalledWith(USER_ID, 9);
    expect(createInactivePeriod).not.toHaveBeenCalled();
  });

  it('본인 루틴이면 기간을 만들고 201을 돌려준다', async () => {
    const res = await post({ start_date: '2026-03-01', end_date: '2026-03-05' });

    expect(res.status).toBe(201);
    expect(createInactivePeriod).toHaveBeenCalledWith(USER_ID, 9, '2026-03-01', '2026-03-05');
  });

  it('end_date를 보내지 않으면 열린 기간으로 만든다', async () => {
    await post({ start_date: '2026-03-01' });

    expect(createInactivePeriod).toHaveBeenCalledWith(USER_ID, 9, '2026-03-01', null);
  });

  it.each([undefined, '', '2026-3-1', 20260301])('start_date %s는 400이다', async (start_date) => {
    const res = await post({ start_date });

    expect(res.status).toBe(400);
    expect(createInactivePeriod).not.toHaveBeenCalled();
  });

  it.each(['', '2026/03/05', 5])('end_date %s는 400이다', async (end_date) => {
    const res = await post({ start_date: '2026-03-01', end_date });

    expect(res.status).toBe(400);
    expect(createInactivePeriod).not.toHaveBeenCalled();
  });

  it('경로 id가 양의 정수가 아니면 400이다', async () => {
    const res = await post({ start_date: '2026-03-01' }, 'abc');

    expect(res.status).toBe(400);
    expect(queryRoutineTemplate).not.toHaveBeenCalled();
  });
});

describe('GET /api/routines/[id]/inactive-periods', () => {
  it('경로 id가 양의 정수가 아니면 400이고 조회하지 않는다', async () => {
    const res = await GET(jsonRequest('GET', PATH), idParams('NaN'));

    expect(res.status).toBe(400);
    expect(queryInactivePeriods).not.toHaveBeenCalled();
  });

  it('user 스코프로 기간 목록을 돌려준다', async () => {
    const res = await GET(jsonRequest('GET', PATH), idParams('9'));

    expect(queryInactivePeriods).toHaveBeenCalledWith(USER_ID, 9);
    expect(await res.json()).toEqual({ data: [PERIOD] });
  });
});
