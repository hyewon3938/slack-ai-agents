import { describe, it, expect, vi, beforeEach } from 'vitest';

// signalSuggestFallbackTask(#466 ADR-0058) — monthly-signal-suggest 미실행 월 "수동 실행" 알림.
// 핵심 회귀 가드: ① 매월 2일만 ② 클레임 row 있으면 no-op / 없으면 알림 1회
//                ③ month_start는 SQL 내부 계산 → 조회 param은 [userId] 하나뿐(weekly의 [userId, today] 아님).

let mockDay = 2; // 2 = 매월 2일
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
}));
vi.mock('../../shared/slack.js', () => ({
  postToChannel: (...a: unknown[]) => mockPost(...a),
}));
vi.mock('../../shared/kst.js', () => ({
  getKSTDayOfMonth: () => mockDay,
}));
vi.mock('../../shared/user-resolver.js', () => ({
  DEFAULT_USER_ID: 1,
  queryAllUserMappings: () => Promise.resolve(mockMappings),
}));

const { signalSuggestFallbackTask } = await import('../signal-suggest-fallback.js');

const app = { client: {} } as never;
const config = { channelId: 'C_FALLBACK', llmClient: {} } as never;

beforeEach(() => {
  vi.clearAllMocks();
  mockDay = 2;
  mockMappings = [];
  delete process.env['INSIGHT_CHANNEL_ID'];
});

describe('signalSuggestFallbackTask — monthly-signal-suggest 미실행 알림 (#466)', () => {
  it('매월 2일 아니면 no-op (쿼리·발송 없음)', async () => {
    mockDay = 5;
    await signalSuggestFallbackTask(app, config);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('클레임 row 있으면 알림 안 보냄 (no-op)', async () => {
    mockQuery.mockResolvedValue({ rows: [{ exists: true }] });
    await signalSuggestFallbackTask(app, config);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('클레임 row 없으면 수동 실행 알림 1회', async () => {
    mockQuery.mockResolvedValue({ rows: [{ exists: false }] });
    await signalSuggestFallbackTask(app, config);
    expect(mockPost).toHaveBeenCalledTimes(1);
    const [, channel, text] = mockPost.mock.calls[0] as [unknown, string, string];
    expect(channel).toBe('C_FALLBACK'); // 매핑 없음 → config.channelId 폴백
    expect(text).toContain('수동 실행');
    expect(text).toContain('monthly-signal-suggest');
  });

  it('조회 param은 [userId] 하나 — month_start는 SQL 내부 DATE_TRUNC 계산', async () => {
    mockQuery.mockResolvedValue({ rows: [{ exists: false }] });
    await signalSuggestFallbackTask(app, config);
    const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([1]); // [userId]만 — weekly의 [userId, today]와 다름
  });

  it('멀티유저 — 미실행 유저만 채널별 알림', async () => {
    mockMappings = [
      { userId: 1, slackUserId: 'U1', lifeChannelId: null, insightChannelId: 'C_INS_1' },
      { userId: 2, slackUserId: 'U2', lifeChannelId: null, insightChannelId: 'C_INS_2' },
    ];
    // user1 실행됨, user2 미실행
    mockQuery.mockImplementation((_sql: string, params: unknown[]) =>
      Promise.resolve({ rows: [{ exists: (params as number[])[0] === 1 }] }),
    );
    await signalSuggestFallbackTask(app, config);
    expect(mockPost).toHaveBeenCalledTimes(1);
    const [, channel] = mockPost.mock.calls[0] as [unknown, string, string];
    expect(channel).toBe('C_INS_2');
  });
});
