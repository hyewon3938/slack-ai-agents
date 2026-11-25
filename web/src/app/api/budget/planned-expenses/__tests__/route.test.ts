import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/features/budget/lib/queries', () => ({
  queryPlannedExpenses: vi.fn(),
  createPlannedExpense: vi.fn(),
  updatePlannedExpense: vi.fn(),
  deletePlannedExpense: vi.fn(),
}));

import { requireAuth } from '@/lib/auth';
import {
  createPlannedExpense,
  deletePlannedExpense,
  queryPlannedExpenses,
  updatePlannedExpense,
} from '@/features/budget/lib/queries';
import { DELETE, GET, PATCH, POST } from '../route';
import { jsonRequest } from '@/app/api/__tests__/route-helpers';

const USER_ID = 7;
const PATH = '/api/budget/planned-expenses';

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(requireAuth).mockResolvedValue(USER_ID);
});

describe('GET /api/budget/planned-expenses', () => {
  it('yearMonth 형식이 틀리면 400이다', async () => {
    const res = await GET(jsonRequest('GET', `${PATH}?yearMonth=2026-3`));

    expect(res.status).toBe(400);
    expect(queryPlannedExpenses).not.toHaveBeenCalled();
  });

  it('yearMonth가 없으면 전체를 조회한다', async () => {
    vi.mocked(queryPlannedExpenses).mockResolvedValue([]);

    const res = await GET(jsonRequest('GET', PATH));

    expect(res.status).toBe(200);
    expect(queryPlannedExpenses).toHaveBeenCalledWith(USER_ID, undefined);
  });
});

describe('POST /api/budget/planned-expenses', () => {
  const base = { year_month: '2026-03', amount: 1000, memo: '여행' };

  it('정상 입력은 저장한다', async () => {
    vi.mocked(createPlannedExpense).mockResolvedValue({ id: 1 } as never);

    const res = await POST(jsonRequest('POST', PATH, base));

    expect(res.status).toBe(201);
    expect(createPlannedExpense).toHaveBeenCalledWith(USER_ID, base);
  });

  it.each([
    ['소수 금액', { amount: 1000.5 }],
    ['0 금액', { amount: 0 }],
    ['숫자 memo', { memo: 3 }],
    ['200자를 넘는 memo', { memo: '가'.repeat(201) }],
    ['숫자 year_month', { year_month: 202603 }],
  ])('%s는 400이고 저장하지 않는다', async (_label, override) => {
    const res = await POST(jsonRequest('POST', PATH, { ...base, ...override }));

    expect(res.status).toBe(400);
    expect(createPlannedExpense).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/budget/planned-expenses', () => {
  it('정상 입력은 수정한다', async () => {
    vi.mocked(updatePlannedExpense).mockResolvedValue({ id: 4 } as never);

    const res = await PATCH(jsonRequest('PATCH', PATH, { id: 4, amount: 2000, memo: null }));

    expect(res.status).toBe(200);
    expect(updatePlannedExpense).toHaveBeenCalledWith(USER_ID, 4, { amount: 2000, memo: null });
  });

  it.each([
    ['소수 id', { id: 1.5, amount: 1000 }],
    ['음수 id', { id: -1, amount: 1000 }],
    ['문자열 id', { id: '4', amount: 1000 }],
    ['소수 금액', { id: 4, amount: 1000.5 }],
    ['숫자 memo', { id: 4, memo: 3 }],
  ])('%s는 400이고 수정하지 않는다', async (_label, body) => {
    const res = await PATCH(jsonRequest('PATCH', PATH, body));

    expect(res.status).toBe(400);
    expect(updatePlannedExpense).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/budget/planned-expenses', () => {
  it.each(['abc', '1.5', '0', ''])('id=%j는 400이다', async (raw) => {
    const res = await DELETE(jsonRequest('DELETE', `${PATH}?id=${raw}`));

    expect(res.status).toBe(400);
    expect(deletePlannedExpense).not.toHaveBeenCalled();
  });

  it('정수 id는 삭제한다', async () => {
    vi.mocked(deletePlannedExpense).mockResolvedValue(true);

    const res = await DELETE(jsonRequest('DELETE', `${PATH}?id=4`));

    expect(res.status).toBe(200);
    expect(deletePlannedExpense).toHaveBeenCalledWith(USER_ID, 4);
  });
});
