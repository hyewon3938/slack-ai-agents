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

import { connectDB } from '../../../shared/db.js';
import { tryLlmInsightFastPath, buildLlmInsightSlackMessage } from '../llm-insight-fast-path.js';
import type { LlmInsightDraft } from '../../../shared/llm-insight-prompts.js';

beforeEach(async () => {
  vi.clearAllMocks();
  mockConnect.mockResolvedValue({ release: vi.fn() });
  await connectDB('postgresql://test@localhost/test');
});

const sayMock = (): { say: ReturnType<typeof vi.fn>; calls: unknown[] } => {
  const calls: unknown[] = [];
  const say = vi.fn(async (arg: unknown) => {
    calls.push(arg);
  });
  return { say: say as unknown as ReturnType<typeof vi.fn>, calls };
};

describe('tryLlmInsightFastPath', () => {
  it('약속 명령어 외 문장은 false 반환 (자유언어 매칭 없음)', async () => {
    const { say } = sayMock();
    const cases = [
      '오늘 일정 뭐 있어',
      '발견 검증 어떻게 됐어',
      'LLM 정확도 알려줘',
      '이번 LLM 어땠어',
      '발견 정확도',
    ];
    for (const text of cases) {
      const result = await tryLlmInsightFastPath(text, say as never, 1);
      expect(result, text).toBe(false);
    }
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('"LLM발견" 매칭 → true + 0건 안내', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const { say, calls } = sayMock();
    const result = await tryLlmInsightFastPath('LLM발견', say as never, 1);
    expect(result).toBe(true);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const blockArg = calls[0] as { blocks: unknown[] };
    const blocksStr = JSON.stringify(blockArg.blocks);
    expect(blocksStr).toContain('아직 발견된 패턴이 없어');
    expect(blocksStr).toContain('누적 검증: 0건');
  });

  it('띄어쓰기 변형 모두 매칭 ("LLM 발견", "LLM  발견", "LLM발견.")', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const { say } = sayMock();
    for (const text of ['LLM 발견', 'LLM  발견', 'LLM발견.', 'llm발견']) {
      const result = await tryLlmInsightFastPath(text, say as never, 1);
      expect(result, text).toBe(true);
    }
  });

  it('누적 hit/miss 있으면 hitRate 표시', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('GROUP BY outcome')) {
        return Promise.resolve({
          rows: [
            { outcome: 'hit', cnt: '6' },
            { outcome: 'miss', cnt: '4' },
            { outcome: 'pending', cnt: '2' },
          ],
        });
      }
      if (sql.includes('ORDER BY discovered_at DESC')) {
        return Promise.resolve({
          rows: [
            {
              discovered_at: '2026-05-10 09:30:00+09',
              slot: 'weekly',
              signal_text: 'sig',
              hypothesis_text: 'hyp',
              confidence: 'medium',
              outcome: 'hit',
              verified_at: '2026-05-17 09:10:00+09',
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const { calls } = sayMock();
    const say = vi.fn(async (arg: unknown) => {
      calls.push(arg);
    });
    const result = await tryLlmInsightFastPath('LLM 발견', say as never, 1);
    expect(result).toBe(true);
    const blocksStr = JSON.stringify(calls[0]);
    expect(blocksStr).toContain('누적 검증 10건');
    expect(blocksStr).toContain('60%');
  });
});

describe('buildLlmInsightSlackMessage', () => {
  const draft: LlmInsightDraft = {
    signal: 'sig',
    hypothesis: 'hyp',
    domains: ['sleep', 'routine'],
    confidence: 'medium',
    verification: { sql: 'SELECT 1', resultType: 'boolean', verifyAfterDays: 7 },
  };

  it('totalVerified < 10 → 점진적 노출 줄 없음', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        { outcome: 'hit', cnt: '3' },
        { outcome: 'miss', cnt: '2' },
      ],
    });
    const { headerText, blocks } = await buildLlmInsightSlackMessage(1, 'weekly', [draft]);
    expect(headerText).toContain('주간 LLM 자율 발견 1건');
    expect(JSON.stringify(blocks)).not.toContain('지난 검증');
  });

  it('totalVerified ≥ 10 → 점진적 노출 줄 포함', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        { outcome: 'hit', cnt: '7' },
        { outcome: 'miss', cnt: '3' },
      ],
    });
    const { blocks } = await buildLlmInsightSlackMessage(1, 'monthly', [draft]);
    expect(JSON.stringify(blocks)).toContain('지난 검증 10건 중 7건 적중 (70%)');
  });
});
