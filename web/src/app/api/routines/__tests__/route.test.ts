import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/kst', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/kst')>();
  return { ...actual, getTodayISO: vi.fn(() => '2026-03-10') };
});

vi.mock('@/features/routine/lib/queries', () => ({
  createRoutineTemplate: vi.fn(),
  backfillRecords: vi.fn(),
  queryRoutineTemplates: vi.fn(),
}));

import { requireAuth } from '@/lib/auth';
import { createRoutineTemplate, backfillRecords } from '@/features/routine/lib/queries';
import type { RoutineTemplateRow } from '@/features/routine/lib/types';
import { POST } from '../route';
import { jsonRequest } from '@/app/api/__tests__/route-helpers';

const USER_ID = 7;
const PATH = '/api/routines';

// 합성 픽스처 (실제 개인 데이터 아님)
const CREATED: RoutineTemplateRow = {
  id: 9,
  name: '물 마시기',
  time_slot: '낮',
  frequency: '격일',
  active: true,
  tracking_mode: 'scheduled',
};

const post = (body: unknown): Promise<Response> => POST(jsonRequest('POST', PATH, body));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(USER_ID);
  vi.mocked(createRoutineTemplate).mockResolvedValue(CREATED);
  vi.mocked(backfillRecords).mockResolvedValue(0);
});

describe('POST /api/routines — 빈도 검증', () => {
  it.each(['매주', '평일', '0일마다', '일마다', 3])('빈도 %s는 400이고 만들지 않는다', async (frequency) => {
    const res = await post({ name: '물 마시기', frequency });

    expect(res.status).toBe(400);
    expect(createRoutineTemplate).not.toHaveBeenCalled();
  });

  it.each(['매일', '격일', '주1회', '3일마다', '10일마다', null])('빈도 %s는 만든다', async (frequency) => {
    const res = await post({ name: '물 마시기', frequency });

    expect(res.status).toBe(201);
    expect(createRoutineTemplate).toHaveBeenCalled();
  });
});

describe('POST /api/routines — 시작일', () => {
  it.each(['2026-3-1', '2026/03/01', ''])('start_date %s는 400이다', async (start_date) => {
    const res = await post({ name: '물 마시기', start_date });

    expect(res.status).toBe(400);
    expect(createRoutineTemplate).not.toHaveBeenCalled();
  });

  it('과거 시작일이면 오늘까지 빈도에 맞춰 백필한다', async () => {
    await post({ name: '물 마시기', frequency: '격일', start_date: '2026-03-01' });

    expect(backfillRecords).toHaveBeenCalledWith(USER_ID, 9, '2026-03-01', '격일', '2026-03-10');
  });
});
