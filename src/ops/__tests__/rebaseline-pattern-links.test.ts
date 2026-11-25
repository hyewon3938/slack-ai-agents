import { describe, it, expect, vi, beforeEach } from 'vitest';

// 재기준선 스크립트가 봇과 같이 SQL 도구 전용 연결을 열고 닫는지 (#665).

const order: string[] = [];

vi.mock('../../shared/config.js', () => ({
  CONFIG: {
    db: { url: 'app-url', sqlToolUrl: 'tool-url', sqlToolRequired: true },
    channels: { insight: '' },
    slack: { botToken: 'test' },
  },
}));

vi.mock('../../shared/db.js', () => ({
  connectDB: vi.fn(async () => {
    order.push('connectDB');
  }),
  disconnectDB: vi.fn(async () => {
    order.push('disconnectDB');
  }),
  query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
}));

vi.mock('../../shared/sql-tools/privilege-sync.js', () => ({
  startSqlToolPool: vi.fn(async () => {
    order.push('startSqlToolPool');
    return true;
  }),
}));

vi.mock('../../shared/pattern/verify-links.js', () => ({
  verifyUserLinks: vi.fn(async () => {
    order.push('verifyUserLinks');
    return [];
  }),
}));

vi.mock('../../cron/weekly-verification/persist-links.js', () => ({
  persistLinkVerification: vi.fn(),
}));
vi.mock('../../shared/slack.js', () => ({ postBlockMessage: vi.fn() }));
vi.mock('../../agents/insight/hypothesis-cards.js', () => ({ buildRebaselineNotice: vi.fn() }));
vi.mock('../../shared/user-resolver.js', () => ({
  DEFAULT_USER_ID: 1,
  queryAllUserMappings: vi.fn(async () => []),
}));
vi.mock('@slack/web-api', () => ({ WebClient: vi.fn() }));

const { main } = await import('../rebaseline-pattern-links.js');
const { startSqlToolPool } = await import('../../shared/sql-tools/privilege-sync.js');

beforeEach(() => {
  order.length = 0;
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('rebaseline main', () => {
  it('앱 연결 뒤 도구 풀을 운영 필수 설정으로 열고, 재검증 뒤 연결을 닫는다', async () => {
    await main([]);

    expect(startSqlToolPool).toHaveBeenCalledWith('tool-url', { required: true });
    expect(order).toEqual(['connectDB', 'startSqlToolPool', 'verifyUserLinks', 'disconnectDB']);
  });
});
