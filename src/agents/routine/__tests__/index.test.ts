import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { KnownEventFromType, SayFn } from '@slack/bolt';
import type { LLMClient, LLMResponse } from '../../../shared/llm.js';
import type { Client as NotionClient } from '@notionhq/client';
import { createRoutineAgent } from '../index.js';

vi.mock('../../../shared/mcp-client.js', () => ({
  getMCPTools: vi.fn(() => [
    {
      name: 'API-post-search',
      description: 'Search',
      inputSchema: { type: 'object', properties: {} },
    },
  ]),
  callMCPTool: vi.fn(),
}));

vi.mock('../../../shared/routine-notion.js', () => ({
  queryTodayRoutineRecords: vi.fn(),
}));

const { queryTodayRoutineRecords } = await import(
  '../../../shared/routine-notion.js'
);
const mockedQueryRecords = vi.mocked(queryTodayRoutineRecords);

const createMockMessage = (text: string): KnownEventFromType<'message'> =>
  ({
    type: 'message',
    text,
    channel: 'C123',
    ts: '1234567890.123456',
    user: 'U123',
  }) as unknown as KnownEventFromType<'message'>;

const createMockLLMClient = (
  responses: LLMResponse[],
): LLMClient => {
  let callIndex = 0;
  return {
    chat: vi.fn(async (): Promise<LLMResponse> => {
      const response = responses[callIndex];
      if (!response) {
        throw new Error('Unexpected LLM call');
      }
      callIndex++;
      return response;
    }),
  };
};

const mockNotionClient = {} as NotionClient;

describe('createRoutineAgent', () => {
  let mockSay: SayFn;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSay = vi.fn() as unknown as SayFn;
  });

  describe('키워드 빠른 경로', () => {
    it('"루틴" 입력 시 LLM 없이 체크리스트를 반환한다', async () => {
      mockedQueryRecords.mockResolvedValueOnce([
        { id: 'p1', title: '루틴A', date: '2026-03-06', completed: false, timeSlot: '아침' },
        { id: 'p2', title: '루틴B', date: '2026-03-06', completed: true, timeSlot: '아침' },
      ]);

      const llmClient = createMockLLMClient([]);
      const agent = createRoutineAgent(llmClient, 'db-123', mockNotionClient);
      await agent(createMockMessage('루틴'), mockSay);

      expect(llmClient.chat).not.toHaveBeenCalled();
      expect(mockSay).toHaveBeenCalledWith(
        expect.objectContaining({ blocks: expect.any(Array) }),
      );
    });

    it('오늘 기록이 없으면 안내 메시지를 반환한다', async () => {
      mockedQueryRecords.mockResolvedValueOnce([]);

      const llmClient = createMockLLMClient([]);
      const agent = createRoutineAgent(llmClient, 'db-123', mockNotionClient);
      await agent(createMockMessage('루틴'), mockSay);

      expect(mockSay).toHaveBeenCalledWith(
        '오늘 루틴 기록이 없어. 아침 알림에서 자동으로 생성돼.',
      );
    });

    it('전부 완료 시 완료 메시지를 반환한다', async () => {
      mockedQueryRecords.mockResolvedValueOnce([
        { id: 'p1', title: '루틴A', date: '2026-03-06', completed: true, timeSlot: '아침' },
      ]);

      const llmClient = createMockLLMClient([]);
      const agent = createRoutineAgent(llmClient, 'db-123', mockNotionClient);
      await agent(createMockMessage('루틴'), mockSay);

      expect(mockSay).toHaveBeenCalledWith('오늘 루틴 전부 완료했어!');
    });
  });

  describe('LLM 에이전트 경로', () => {
    it('자연어 요청은 LLM 에이전트 루프를 실행한다', async () => {
      const llmClient = createMockLLMClient([
        { text: '오전 루틴에 추가했어.', toolCalls: [], finishReason: 'stop' },
      ]);

      const agent = createRoutineAgent(llmClient, 'db-123', mockNotionClient);
      await agent(createMockMessage('스트레칭 오전에 추가해줘'), mockSay);

      expect(llmClient.chat).toHaveBeenCalledTimes(1);
      expect(mockSay).toHaveBeenCalledWith('오전 루틴에 추가했어.');
    });

    it('LLM 오류 시 에러 메시지를 반환한다', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const llmClient: LLMClient = {
        chat: vi.fn().mockRejectedValue(new Error('API 연결 실패')),
      };

      const agent = createRoutineAgent(llmClient, 'db-123', mockNotionClient);
      await agent(createMockMessage('루틴 목록 보여줘'), mockSay);

      expect(mockSay).toHaveBeenCalledWith(
        '일시적인 오류가 발생했어. 다시 한번 말해줘.',
      );

      consoleSpy.mockRestore();
    });
  });
});
