import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// forEachUser — #life·#insight 크론 공통 유저 루프 (src/cron/life/user-loop.ts).
// insight-user-loop와 달리 life 타입은 전용 채널이 없으면 slackUserId(DM)로 보낸다.

interface Mapping {
  userId: number;
  slackUserId: string;
  lifeChannelId: string | null;
  insightChannelId: string | null;
}

let mockMappings: Mapping[] = [];
const mockQueryMappings = vi.fn(() => Promise.resolve(mockMappings));

vi.mock('../../../shared/user-resolver.js', () => ({
  DEFAULT_USER_ID: 1,
  queryAllUserMappings: (): Promise<Mapping[]> => mockQueryMappings(),
}));

const { forEachUser } = await import('../user-loop.js');

const config = { channelId: 'C_CONFIG', llmClient: {} } as never;
const noChannelConfig = { channelId: '', llmClient: {} } as never;
const mapping = (
  userId: number,
  channels: { life?: string | null; insight?: string | null } = {},
): Mapping => ({
  userId,
  slackUserId: `U${userId}`,
  lifeChannelId: channels.life ?? null,
  insightChannelId: channels.insight ?? null,
});

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockMappings = [];
  delete process.env['INSIGHT_CHANNEL_ID'];
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  errorSpy.mockRestore();
  delete process.env['INSIGHT_CHANNEL_ID'];
});

describe('forEachUser — 매핑 0건', () => {
  it('life는 config.channelId로 DEFAULT_USER_ID 1회 실행', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    await forEachUser(config, 'life', 'T', handler);
    expect(handler.mock.calls).toEqual([[1, 'C_CONFIG']]);
  });

  it('insight는 INSIGHT_CHANNEL_ID로 실행', async () => {
    process.env['INSIGHT_CHANNEL_ID'] = 'C_ENV';
    const handler = vi.fn().mockResolvedValue(undefined);
    await forEachUser(config, 'insight', 'T', handler);
    expect(handler.mock.calls).toEqual([[1, 'C_ENV']]);
  });

  it('insight는 INSIGHT_CHANNEL_ID가 없으면 config.channelId가 있어도 실행하지 않음', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    await forEachUser(config, 'insight', 'T', handler);
    expect(handler).not.toHaveBeenCalled();
  });

  it('life 폴백 채널이 비어 있으면 실행하지 않음', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    await forEachUser(noChannelConfig, 'life', 'T', handler);
    expect(handler).not.toHaveBeenCalled();
  });

  it('폴백 실행 오류는 삼키고 폴백 실패 로그', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(forEachUser(config, 'life', '아침 일정', handler)).resolves.toBeUndefined();
    expect(errorSpy.mock.calls).toEqual([['[Life Cron] 아침 일정 폴백 실행 실패: boom']]);
  });
});

describe('forEachUser — 매핑 존재', () => {
  it('life: 전용 채널 우선, 없으면 slackUserId(DM)로 조회 순서대로 실행', async () => {
    mockMappings = [mapping(7, { life: 'C_LIFE7', insight: 'C_INS7' }), mapping(3)];
    const handler = vi.fn().mockResolvedValue(undefined);
    await forEachUser(config, 'life', 'T', handler);
    expect(handler.mock.calls).toEqual([
      [7, 'C_LIFE7'],
      [3, 'U3'],
    ]);
  });

  it('insight: insightChannelId를 쓰고 없으면 slackUserId(DM)', async () => {
    mockMappings = [
      mapping(7, { life: 'C_LIFE7', insight: 'C_INS7' }),
      mapping(3, { life: 'C_LIFE3' }),
    ];
    const handler = vi.fn().mockResolvedValue(undefined);
    await forEachUser(config, 'insight', 'T', handler);
    expect(handler.mock.calls).toEqual([
      [7, 'C_INS7'],
      [3, 'U3'],
    ]);
  });

  it('한 유저가 실패해도 다음 유저를 계속 처리하고 실패 로그를 남김', async () => {
    mockMappings = [mapping(2, { life: 'C2' }), mapping(3, { life: 'C3' })];
    const handler = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
    await forEachUser(config, 'life', '밤 리뷰', handler);
    expect(handler.mock.calls).toEqual([
      [2, 'C2'],
      [3, 'C3'],
    ]);
    expect(errorSpy.mock.calls).toEqual([['[Life Cron] 밤 리뷰 유저 2 처리 실패: boom']]);
  });

  it('매핑 조회 실패는 호출자에게 올라감', async () => {
    mockQueryMappings.mockRejectedValueOnce(new Error('db down'));
    const handler = vi.fn();
    await expect(forEachUser(config, 'life', 'T', handler)).rejects.toThrow('db down');
    expect(handler).not.toHaveBeenCalled();
  });
});
