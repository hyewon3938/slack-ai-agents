import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// forEachInsightUser / forEachInsightMapping — #insight 크론 공통 유저 루프.
// 핵심 회귀 가드: ① 폴백 채널 = INSIGHT_CHANNEL_ID ?? config.channelId (DM 폴백 없음)
//                ② 매핑 0건 분기의 오류 처리(isolate/propagate) ③ 유저별 오류 격리·로그 문구·순회 순서.

interface Mapping {
  userId: number;
  slackUserId: string;
  lifeChannelId: string | null;
  insightChannelId: string | null;
}

let mockMappings: Mapping[] = [];
const mockQueryMappings = vi.fn(() => Promise.resolve(mockMappings));

vi.mock('../../shared/user-resolver.js', () => ({
  DEFAULT_USER_ID: 1,
  queryAllUserMappings: (): Promise<Mapping[]> => mockQueryMappings(),
}));

const { forEachInsightUser, forEachInsightMapping } = await import('../insight-user-loop.js');

const config = { channelId: 'C_CONFIG', llmClient: {} } as never;
const noChannelConfig = { channelId: '', llmClient: {} } as never;
const mapping = (userId: number, insightChannelId: string | null): Mapping => ({
  userId,
  slackUserId: `U${userId}`,
  lifeChannelId: null,
  insightChannelId,
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

describe('forEachInsightUser — 매핑 0건', () => {
  it('config.channelId로 DEFAULT_USER_ID 1회 실행', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    await forEachInsightUser(config, { logPrefix: 'T', fallbackErrors: 'isolate' }, handler);
    expect(handler.mock.calls).toEqual([[1, 'C_CONFIG']]);
  });

  it('INSIGHT_CHANNEL_ID가 config.channelId보다 우선', async () => {
    process.env['INSIGHT_CHANNEL_ID'] = 'C_ENV';
    const handler = vi.fn().mockResolvedValue(undefined);
    await forEachInsightUser(config, { logPrefix: 'T', fallbackErrors: 'isolate' }, handler);
    expect(handler.mock.calls).toEqual([[1, 'C_ENV']]);
  });

  it('폴백 채널이 없으면 실행하지 않음', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    await forEachInsightUser(
      noChannelConfig,
      { logPrefix: 'T', fallbackErrors: 'propagate' },
      handler,
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("fallbackErrors='isolate' — 오류를 삼키고 폴백 실패 로그", async () => {
    const handler = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(
      forEachInsightUser(
        config,
        { logPrefix: 'Period Fortune', fallbackErrors: 'isolate' },
        handler,
      ),
    ).resolves.toBeUndefined();
    expect(errorSpy.mock.calls).toEqual([['[Period Fortune] 폴백 실행 실패: boom']]);
  });

  it("fallbackErrors='propagate' — 오류를 그대로 올리고 로그 없음", async () => {
    const handler = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(
      forEachInsightUser(
        config,
        { logPrefix: 'Verification', fallbackErrors: 'propagate' },
        handler,
      ),
    ).rejects.toThrow('boom');
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('forEachInsightUser — 매핑 존재', () => {
  it('조회 순서대로 실행, 전용 채널 우선·NULL이면 폴백 채널(DM 아님)', async () => {
    mockMappings = [mapping(7, 'C_USER7'), mapping(3, null)];
    const handler = vi.fn().mockResolvedValue(undefined);
    await forEachInsightUser(config, { logPrefix: 'T', fallbackErrors: 'isolate' }, handler);
    expect(handler.mock.calls).toEqual([
      [7, 'C_USER7'],
      [3, 'C_CONFIG'],
    ]);
  });

  it('채널을 못 정한 유저는 건너뜀', async () => {
    mockMappings = [mapping(2, null), mapping(3, 'C_USER3')];
    const handler = vi.fn().mockResolvedValue(undefined);
    await forEachInsightUser(
      noChannelConfig,
      { logPrefix: 'T', fallbackErrors: 'isolate' },
      handler,
    );
    expect(handler.mock.calls).toEqual([[3, 'C_USER3']]);
  });

  it('유저별 오류 격리 — propagate여도 잡고 다음 유저 진행, 기본 로그 문구', async () => {
    mockMappings = [mapping(2, 'C2'), mapping(3, 'C3')];
    const handler = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
    await forEachInsightUser(
      config,
      { logPrefix: 'Verification', fallbackErrors: 'propagate' },
      handler,
    );
    expect(handler).toHaveBeenCalledTimes(2);
    expect(errorSpy.mock.calls).toEqual([['[Verification] user=2 처리 실패: boom']]);
  });

  it('userFailureLabel로 실패 문구 교체, Error가 아닌 값은 String 변환', async () => {
    mockMappings = [mapping(2, 'C2')];
    const handler = vi.fn().mockRejectedValue('raw');
    await forEachInsightUser(
      config,
      { logPrefix: 'Discovery', userFailureLabel: '재추천 실패', fallbackErrors: 'propagate' },
      handler,
    );
    expect(errorSpy.mock.calls).toEqual([['[Discovery] user=2 재추천 실패: raw']]);
  });

  it('매핑 조회 실패는 호출자에게 올라감', async () => {
    mockQueryMappings.mockRejectedValueOnce(new Error('db down'));
    const handler = vi.fn();
    await expect(
      forEachInsightUser(config, { logPrefix: 'T', fallbackErrors: 'isolate' }, handler),
    ).rejects.toThrow('db down');
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('forEachInsightMapping — 조회한 매핑 전달', () => {
  it('매핑을 다시 조회하지 않음', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    await forEachInsightMapping(
      [mapping(5, 'C5')],
      config,
      { logPrefix: 'T', fallbackErrors: 'isolate' },
      handler,
    );
    expect(mockQueryMappings).not.toHaveBeenCalled();
    expect(handler.mock.calls).toEqual([[5, 'C5']]);
  });
});
