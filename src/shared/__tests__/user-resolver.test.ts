import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockConnect = vi.fn();

vi.mock('pg', () => {
  const MockPool = vi.fn(function (this: Record<string, unknown>) {
    this.query = mockQuery;
    this.connect = mockConnect;
    this.end = vi.fn();
  });
  return { default: { Pool: MockPool, types: { setTypeParser: vi.fn() } } };
});

import { connectDB } from '../db.js';
import { queryAllUserMappings, resolveUserId } from '../user-resolver.js';

beforeEach(async () => {
  vi.clearAllMocks();
  mockConnect.mockResolvedValue({ release: vi.fn() });
  await connectDB('postgresql://test@localhost/test');
});

describe('queryAllUserMappings', () => {
  it('등록된 모든 매핑을 UserMapping 형태로 반환한다', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { user_id: 1, slack_user_id: 'U1', life_channel_id: 'C_life', insight_channel_id: 'C_insight' },
        { user_id: 2, slack_user_id: 'U2', life_channel_id: null, insight_channel_id: null },
      ],
    });

    const result = await queryAllUserMappings();

    expect(result).toEqual([
      { userId: 1, slackUserId: 'U1', lifeChannelId: 'C_life', insightChannelId: 'C_insight' },
      { userId: 2, slackUserId: 'U2', lifeChannelId: null, insightChannelId: null },
    ]);
  });

  it('매핑이 없으면 빈 배열을 반환한다', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await queryAllUserMappings();
    expect(result).toEqual([]);
  });
});

describe('resolveUserId', () => {
  it('매핑이 존재하면 user_id 반환', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 7 }] });
    expect(await resolveUserId('U_test')).toBe(7);
  });

  it('매핑이 없으면 null 반환', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await resolveUserId('U_unknown')).toBeNull();
  });
});
