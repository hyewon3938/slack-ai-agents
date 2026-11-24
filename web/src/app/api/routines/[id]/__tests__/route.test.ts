import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/kst', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/kst')>();
  return { ...actual, getTodayISO: vi.fn(() => '2026-03-10') };
});

vi.mock('@/features/routine/lib/queries', () => ({
  updateRoutineTemplate: vi.fn(),
  deleteRoutineTemplate: vi.fn(),
  createInactivePeriod: vi.fn(),
  closeOpenInactivePeriod: vi.fn(),
  queryRoutineTemplate: vi.fn(),
  deleteRecordsBefore: vi.fn(),
  countCompletedRecordsBefore: vi.fn(),
  deleteIncompleteScheduledRecordOn: vi.fn(),
}));

import { requireAuth } from '@/lib/auth';
import {
  updateRoutineTemplate,
  createInactivePeriod,
  closeOpenInactivePeriod,
  queryRoutineTemplate,
  deleteRecordsBefore,
  countCompletedRecordsBefore,
  deleteIncompleteScheduledRecordOn,
} from '@/features/routine/lib/queries';
import type { RoutineTemplateRow } from '@/features/routine/lib/types';
import { PATCH } from '../route';
import { idParams, jsonRequest } from '@/app/api/__tests__/route-helpers';

const USER_ID = 7;
const TODAY = '2026-03-10';
const PATH = '/api/routines/9';

const TEMPLATE: RoutineTemplateRow = {
  id: 9,
  name: '물 마시기',
  time_slot: '낮',
  frequency: '매일',
  active: true,
  tracking_mode: 'scheduled',
  start_date: '2026-03-01',
};

const patch = (body: unknown): Promise<Response> => PATCH(jsonRequest('PATCH', PATH, body), idParams('9'));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(USER_ID);
  vi.mocked(queryRoutineTemplate).mockResolvedValue(TEMPLATE);
  vi.mocked(updateRoutineTemplate).mockResolvedValue(TEMPLATE);
  vi.mocked(countCompletedRecordsBefore).mockResolvedValue(0);
});

describe('PATCH /api/routines/[id] — 검증', () => {
  it('로그인하지 않았으면 401이고 조회하지 않는다', async () => {
    vi.mocked(requireAuth).mockResolvedValue(null);

    const res = await patch({ name: '새 이름' });

    expect(res.status).toBe(401);
    expect(queryRoutineTemplate).not.toHaveBeenCalled();
  });

  it('허용되지 않은 tracking_mode는 400이고 수정하지 않는다', async () => {
    const res = await patch({ tracking_mode: 'weekly' });

    expect(res.status).toBe(400);
    expect(updateRoutineTemplate).not.toHaveBeenCalled();
  });

  it('루틴이 없으면 404이고 수정하지 않는다', async () => {
    vi.mocked(queryRoutineTemplate).mockResolvedValue(null);

    const res = await patch({ name: '새 이름' });

    expect(res.status).toBe(404);
    expect(updateRoutineTemplate).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/routines/[id] — 활성 토글', () => {
  it('active:false면 오늘부터 열린 비활성 기간을 만든다', async () => {
    await patch({ active: false });

    expect(createInactivePeriod).toHaveBeenCalledWith(USER_ID, 9, TODAY, null);
    expect(closeOpenInactivePeriod).not.toHaveBeenCalled();
  });

  it('active:true면 열린 비활성 기간을 어제 날짜로 닫는다', async () => {
    await patch({ active: true });

    expect(closeOpenInactivePeriod).toHaveBeenCalledWith(USER_ID, 9, '2026-03-09');
    expect(createInactivePeriod).not.toHaveBeenCalled();
  });

  it('active를 보내지 않으면 비활성 기간을 건드리지 않는다', async () => {
    await patch({ name: '새 이름' });

    expect(createInactivePeriod).not.toHaveBeenCalled();
    expect(closeOpenInactivePeriod).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/routines/[id] — 추적 모드 전환', () => {
  it('scheduled에서 free로 바꾸면 오늘 미완료 기록을 지운다', async () => {
    await patch({ tracking_mode: 'free' });

    expect(deleteIncompleteScheduledRecordOn).toHaveBeenCalledWith(USER_ID, 9, TODAY);
  });

  it('이미 free인 루틴에 free를 보내면 기록을 지우지 않는다', async () => {
    vi.mocked(queryRoutineTemplate).mockResolvedValue({ ...TEMPLATE, tracking_mode: 'free' });

    await patch({ tracking_mode: 'free' });

    expect(deleteIncompleteScheduledRecordOn).not.toHaveBeenCalled();
  });

  it('free에서 scheduled로 바꾸면 기록을 지우지 않는다', async () => {
    vi.mocked(queryRoutineTemplate).mockResolvedValue({ ...TEMPLATE, tracking_mode: 'free' });

    await patch({ tracking_mode: 'scheduled' });

    expect(deleteIncompleteScheduledRecordOn).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/routines/[id] — 시작일 변경', () => {
  it('시작일을 늦추면 새 시작일 이전의 미완료 기록을 지우고 완료 기록 수를 돌려준다', async () => {
    vi.mocked(updateRoutineTemplate).mockResolvedValue({ ...TEMPLATE, start_date: '2026-03-05' });
    vi.mocked(countCompletedRecordsBefore).mockResolvedValue(2);

    const res = await patch({ start_date: '2026-03-05' });

    expect(deleteRecordsBefore).toHaveBeenCalledWith(USER_ID, 9, '2026-03-05', false);
    expect(countCompletedRecordsBefore).toHaveBeenCalledWith(USER_ID, 9, '2026-03-05');
    expect((await res.json()).staleCompletedCount).toBe(2);
  });

  it('시작일을 앞당기면 기록을 지우지 않는다', async () => {
    vi.mocked(updateRoutineTemplate).mockResolvedValue({ ...TEMPLATE, start_date: '2026-02-20' });

    const res = await patch({ start_date: '2026-02-20' });

    expect(deleteRecordsBefore).not.toHaveBeenCalled();
    expect((await res.json()).staleCompletedCount).toBe(0);
  });

  it('시작일이 그대로면 기록을 지우지 않는다', async () => {
    await patch({ start_date: '2026-03-01' });

    expect(deleteRecordsBefore).not.toHaveBeenCalled();
  });
});
