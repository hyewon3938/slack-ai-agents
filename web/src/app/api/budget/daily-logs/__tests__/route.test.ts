import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/features/budget/lib/queries', () => ({
  queryDailyBudgetLogs: vi.fn(),
}));

import { requireAuth } from '@/lib/auth';
import { queryDailyBudgetLogs } from '@/features/budget/lib/queries';
import { GET } from '../route';
import { jsonRequest } from '@/app/api/__tests__/route-helpers';

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(requireAuth).mockResolvedValue(7);
});

describe('GET /api/budget/daily-logs', () => {
  it('조회가 실패하면 500이고 내부 에러 메시지는 응답에 담지 않는다', async () => {
    vi.mocked(queryDailyBudgetLogs).mockRejectedValue(
      new Error('relation "daily_budget_logs" does not exist'),
    );

    const res = await GET(jsonRequest('GET', '/api/budget/daily-logs?yearMonth=2026-03'));
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(500);
    expect(body.error).not.toContain('relation');
  });
});
