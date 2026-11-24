import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/features/budget/lib/facade', () => ({
  runSettlementIfDue: vi.fn(),
}));

vi.mock('@/lib/users', () => ({
  listAllUserIds: vi.fn(),
}));

import { runSettlementIfDue } from '@/features/budget/lib/facade';
import { listAllUserIds } from '@/lib/users';
import type { SettlementSnapshot } from '@/features/budget/lib/types-v2';
import { GET } from '../route';

// 테스트 전용 placeholder
const CRON_SECRET = 'test-cron-secret';

// 합성 픽스처 — 지어낸 값
const snapshot = (yearMonth: string): SettlementSnapshot => ({
  year_month: yearMonth,
  allocated_budget: 1000,
  fixed_total: 0,
  installment_total: 0,
  planned_total: 0,
  flexible_spent: 0,
  excluded_spent: 0,
  income_total: 0,
  available_at_start: 2000,
  available_at_end: 1000,
});

const cronRequest = (authorization: string | null = `Bearer ${CRON_SECRET}`): Request =>
  new Request('http://localhost/api/cron/monthly-settlement', {
    headers: authorization === null ? {} : { authorization },
  });

interface SettlementBody {
  ok: boolean;
  results: Array<{ userId: number; settled: boolean; yearMonths?: string[]; error?: string }>;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubEnv('CRON_SECRET', CRON_SECRET);
  vi.mocked(listAllUserIds).mockResolvedValue([1]);
  vi.mocked(runSettlementIfDue).mockResolvedValue({ settled: false, snapshots: [] });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/cron/monthly-settlement — 인증', () => {
  it('CRON_SECRET이 없으면 빈 Bearer 헤더로도 401이다', async () => {
    vi.stubEnv('CRON_SECRET', '');

    const res = await GET(cronRequest('Bearer '));

    expect(res.status).toBe(401);
    expect(listAllUserIds).not.toHaveBeenCalled();
  });

  it('authorization 헤더가 다르면 401이다', async () => {
    const res = await GET(cronRequest('Bearer wrong-secret'));

    expect(res.status).toBe(401);
    expect(runSettlementIfDue).not.toHaveBeenCalled();
  });

  it('authorization 헤더가 없으면 401이다', async () => {
    const res = await GET(cronRequest(null));

    expect(res.status).toBe(401);
  });
});

describe('GET /api/cron/monthly-settlement — 유저별 처리', () => {
  it('한 유저가 실패해도 나머지 유저를 정산하고 결과에 실패 사유를 남긴다', async () => {
    vi.mocked(listAllUserIds).mockResolvedValue([1, 2, 3]);
    vi.mocked(runSettlementIfDue).mockImplementation(async (uid) => {
      if (uid === 2) throw new Error('settlement failed');
      return { settled: true, snapshots: [snapshot('2026-02')] };
    });

    const res = await GET(cronRequest());
    const body = (await res.json()) as SettlementBody;

    expect(res.status).toBe(200);
    expect(runSettlementIfDue).toHaveBeenCalledTimes(3);
    expect(body.results).toEqual([
      { userId: 1, settled: true, yearMonths: ['2026-02'] },
      { userId: 2, settled: false, error: 'settlement failed' },
      { userId: 3, settled: true, yearMonths: ['2026-02'] },
    ]);
  });

  it('정산할 달이 없으면 yearMonths 없이 settled false로 남긴다', async () => {
    const res = await GET(cronRequest());
    const body = (await res.json()) as SettlementBody;

    expect(body.results).toEqual([{ userId: 1, settled: false }]);
  });
});
