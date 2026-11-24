import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/features/budget/lib/queries', () => ({
  saveDailyBudgetLog: vi.fn(),
}));

vi.mock('@/lib/users', () => ({
  listAllUserIds: vi.fn(),
}));

import { saveDailyBudgetLog } from '@/features/budget/lib/queries';
import { listAllUserIds } from '@/lib/users';
import { GET } from '../route';

// 테스트 전용 placeholder
const CRON_SECRET = 'test-cron-secret';

// 합성 픽스처 — 지어낸 값
const LOG_RESULT = { date: '2026-03-10', budget: 1000, spent: 0, saved: 1000 };

const cronRequest = (
  query = '',
  authorization: string | null = `Bearer ${CRON_SECRET}`,
): Request =>
  new Request(`http://localhost/api/cron/daily-budget-log${query}`, {
    headers: authorization === null ? {} : { authorization },
  });

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubEnv('CRON_SECRET', CRON_SECRET);
  // KST 2026-03-11 05:00 발화 → 전일 2026-03-10이 기본 대상
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-03-10T20:00:00Z'));
  vi.mocked(listAllUserIds).mockResolvedValue([1, 2]);
  vi.mocked(saveDailyBudgetLog).mockResolvedValue(LOG_RESULT);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('GET /api/cron/daily-budget-log — 인증', () => {
  it('CRON_SECRET이 없으면 빈 Bearer 헤더로도 401이다', async () => {
    vi.stubEnv('CRON_SECRET', '');

    const res = await GET(cronRequest('', 'Bearer '));

    expect(res.status).toBe(401);
    expect(listAllUserIds).not.toHaveBeenCalled();
  });

  it('authorization 헤더가 다르면 401이다', async () => {
    const res = await GET(cronRequest('', 'Bearer wrong-secret'));

    expect(res.status).toBe(401);
    expect(saveDailyBudgetLog).not.toHaveBeenCalled();
  });

  it('authorization 헤더가 없으면 401이다', async () => {
    const res = await GET(cronRequest('', null));

    expect(res.status).toBe(401);
  });
});

describe('GET /api/cron/daily-budget-log — 대상 날짜', () => {
  it('date 파라미터가 없으면 KST 기준 전일로 저장한다', async () => {
    await GET(cronRequest());

    expect(saveDailyBudgetLog).toHaveBeenCalledWith(1, { targetDate: '2026-03-10' });
  });

  it('YYYY-MM-DD 형식의 date 파라미터는 그 날짜로 저장한다', async () => {
    await GET(cronRequest('?date=2026-02-01'));

    expect(saveDailyBudgetLog).toHaveBeenCalledWith(1, { targetDate: '2026-02-01' });
  });

  it.each(['2026-2-1', '20260201', 'yesterday'])(
    '형식이 틀린 date=%s는 무시하고 전일로 저장한다',
    async (date) => {
      await GET(cronRequest(`?date=${date}`));

      expect(saveDailyBudgetLog).toHaveBeenCalledWith(1, { targetDate: '2026-03-10' });
    },
  );
});

describe('GET /api/cron/daily-budget-log — 유저별 처리', () => {
  it('한 유저가 실패해도 나머지 유저를 처리하고 결과에 실패로 남긴다', async () => {
    vi.mocked(listAllUserIds).mockResolvedValue([1, 2, 3]);
    vi.mocked(saveDailyBudgetLog).mockImplementation(async (uid) => {
      if (uid === 2) throw new Error('save failed');
      return LOG_RESULT;
    });

    const res = await GET(cronRequest());
    const body = (await res.json()) as { results: Array<{ userId: number; ok: boolean }> };

    expect(res.status).toBe(200);
    expect(saveDailyBudgetLog).toHaveBeenCalledTimes(3);
    expect(body.results.map((r) => [r.userId, r.ok])).toEqual([
      [1, true],
      [2, false],
      [3, true],
    ]);
  });

  it('유저 목록 조회가 실패하면 500이다', async () => {
    vi.mocked(listAllUserIds).mockRejectedValue(new Error('db down'));

    const res = await GET(cronRequest());

    expect(res.status).toBe(500);
  });
});
