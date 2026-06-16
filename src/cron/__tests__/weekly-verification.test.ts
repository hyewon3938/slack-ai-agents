import { describe, it, expect, vi, beforeEach } from 'vitest';

// weeklyReviewFallbackTask(#542 ADR-0052) — routine 미발송 주 "수동 실행" 알림.
// 핵심 회귀 가드: ① 월요일만 ② 발송기록 있으면 no-op / 없으면 알림 1회
//                ③ week_start = 오늘(이번 주 월요일) — SKILL idempotency 키와 일치(previousMondayISO 아님).

let mockDow = 1; // 1 = 월요일
const mockQuery = vi.fn();
const mockPost = vi.fn();
let mockMappings: Array<{
  userId: number;
  slackUserId: string;
  lifeChannelId: string | null;
  insightChannelId: string | null;
}> = [];

vi.mock('../../shared/db.js', () => ({
  query: (...a: unknown[]) => mockQuery(...a),
  withTransaction: vi.fn(),
}));
vi.mock('../../shared/slack.js', () => ({
  postToChannel: (...a: unknown[]) => mockPost(...a),
  postBlockMessage: vi.fn(),
}));
vi.mock('../../shared/kst.js', () => ({
  getKSTDayOfWeek: () => mockDow,
  getTodayISO: () => '2026-06-15', // 월요일
}));
vi.mock('../../shared/user-resolver.js', () => ({
  DEFAULT_USER_ID: 1,
  queryAllUserMappings: () => Promise.resolve(mockMappings),
}));

const { weeklyReviewFallbackTask } = await import('../weekly-verification.js');

const app = { client: {} } as never;
const config = { channelId: 'C_FALLBACK', llmClient: {} } as never;

beforeEach(() => {
  vi.clearAllMocks();
  mockDow = 1;
  mockMappings = [];
  delete process.env['INSIGHT_CHANNEL_ID'];
});

describe('weeklyReviewFallbackTask — routine 미발송 알림 (#542)', () => {
  it('월요일 아니면 no-op (쿼리·발송 없음)', async () => {
    mockDow = 3;
    await weeklyReviewFallbackTask(app, config);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('발송 기록 있으면 알림 안 보냄 (no-op)', async () => {
    mockQuery.mockResolvedValue({ rows: [{ exists: true }] });
    await weeklyReviewFallbackTask(app, config);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('발송 기록 없으면 수동 실행 알림 1회', async () => {
    mockQuery.mockResolvedValue({ rows: [{ exists: false }] });
    await weeklyReviewFallbackTask(app, config);
    expect(mockPost).toHaveBeenCalledTimes(1);
    const [, channel, text] = mockPost.mock.calls[0] as [unknown, string, string];
    expect(channel).toBe('C_FALLBACK'); // 매핑 없음 → config.channelId 폴백
    expect(text).toContain('수동 실행');
    expect(text).toContain('weekly-saju-review-v2');
  });

  it('week_start = 오늘(이번 주 월요일)로 조회 — SKILL 키와 일치(previousMondayISO 아님)', async () => {
    mockQuery.mockResolvedValue({ rows: [{ exists: false }] });
    await weeklyReviewFallbackTask(app, config);
    const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([1, '2026-06-15']); // [userId, today]
  });

  it('멀티유저 — 미발송 유저만 채널별 알림', async () => {
    mockMappings = [
      { userId: 1, slackUserId: 'U1', lifeChannelId: null, insightChannelId: 'C_INS_1' },
      { userId: 2, slackUserId: 'U2', lifeChannelId: null, insightChannelId: 'C_INS_2' },
    ];
    // user1 발송됨, user2 미발송
    mockQuery.mockImplementation((_sql: string, params: unknown[]) =>
      Promise.resolve({ rows: [{ exists: (params as number[])[0] === 1 }] }),
    );
    await weeklyReviewFallbackTask(app, config);
    expect(mockPost).toHaveBeenCalledTimes(1);
    const [, channel] = mockPost.mock.calls[0] as [unknown, string, string];
    expect(channel).toBe('C_INS_2');
  });
});
