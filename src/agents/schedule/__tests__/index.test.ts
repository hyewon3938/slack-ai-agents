import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { KnownEventFromType, SayFn } from '@slack/bolt';
import type { LLMClient, LLMResponse } from '../../../shared/llm.js';
import { createScheduleAgent } from '../index.js';

vi.mock('../../../shared/mcp-client.js', () => ({
  getMCPTools: vi.fn(() => [
    {
      name: 'notion_search',
      description: 'Search Notion',
      inputSchema: { type: 'object', properties: {} },
    },
  ]),
  callMCPTool: vi.fn(),
}));

const { callMCPTool } = await import('../../../shared/mcp-client.js');
const mockedCallMCPTool = vi.mocked(callMCPTool);

/** 의도 분류용 'action' 응답 */
const CLASSIFY_ACTION: LLMResponse = { text: 'action', toolCalls: [], finishReason: 'stop' };

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

describe('createScheduleAgent', () => {
  let mockSay: SayFn;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSay = vi.fn() as unknown as SayFn;
  });

  it('단순 텍스트 응답을 반환한다 (tool call 없음)', async () => {
    const llmClient = createMockLLMClient([
      CLASSIFY_ACTION,
      { text: '오늘 일정이 없습니다.', toolCalls: [], finishReason: 'stop' },
    ]);

    const agent = createScheduleAgent(llmClient, 'db-123');
    await agent(createMockMessage('오늘 일정 보여줘'), mockSay);

    expect(mockSay).toHaveBeenCalledWith('오늘 일정이 없습니다.');
    // classify(1) + agent(1)
    expect(llmClient.chat).toHaveBeenCalledTimes(2);
  });

  it('tool call 1회 후 최종 응답을 반환한다', async () => {
    mockedCallMCPTool.mockResolvedValueOnce('{"results": []}');

    const llmClient = createMockLLMClient([
      CLASSIFY_ACTION,
      {
        text: null,
        toolCalls: [
          { id: 'call_1', name: 'notion_search', arguments: { query: '일정' } },
        ],
        finishReason: 'tool_calls',
      },
      {
        text: '일정을 찾지 못했습니다.',
        toolCalls: [],
        finishReason: 'stop',
      },
    ]);

    const agent = createScheduleAgent(llmClient, 'db-123');
    await agent(createMockMessage('일정 검색해줘'), mockSay);

    expect(mockedCallMCPTool).toHaveBeenCalledWith('notion_search', { query: '일정' });
    expect(mockSay).toHaveBeenCalledWith('일정을 찾지 못했습니다.');
    // classify(1) + agent(2)
    expect(llmClient.chat).toHaveBeenCalledTimes(3);
  });

  it('tool call 여러 회 연속 실행을 처리한다', async () => {
    mockedCallMCPTool
      .mockResolvedValueOnce('{"results": [{"id": "page-1"}]}')
      .mockResolvedValueOnce('{"ok": true}');

    const llmClient = createMockLLMClient([
      CLASSIFY_ACTION,
      {
        text: null,
        toolCalls: [
          { id: 'call_1', name: 'notion_search', arguments: { query: '미팅' } },
        ],
        finishReason: 'tool_calls',
      },
      {
        text: null,
        toolCalls: [
          { id: 'call_2', name: 'notion_update', arguments: { page_id: 'page-1' } },
        ],
        finishReason: 'tool_calls',
      },
      {
        text: '미팅 일정을 수정했습니다.',
        toolCalls: [],
        finishReason: 'stop',
      },
    ]);

    const agent = createScheduleAgent(llmClient, 'db-123');
    await agent(createMockMessage('미팅 일정 수정해줘'), mockSay);

    expect(mockedCallMCPTool).toHaveBeenCalledTimes(2);
    // classify(1) + agent(3)
    expect(llmClient.chat).toHaveBeenCalledTimes(4);
    expect(mockSay).toHaveBeenCalledWith('미팅 일정을 수정했습니다.');
  });

  it('tool call 실패 시 에러 메시지를 LLM에 전달한다', async () => {
    mockedCallMCPTool.mockRejectedValueOnce(new Error('Notion API 오류'));

    const llmClient = createMockLLMClient([
      CLASSIFY_ACTION,
      {
        text: null,
        toolCalls: [
          { id: 'call_1', name: 'notion_search', arguments: {} },
        ],
        finishReason: 'tool_calls',
      },
      {
        text: 'Notion 연결에 문제가 있습니다.',
        toolCalls: [],
        finishReason: 'stop',
      },
    ]);

    const agent = createScheduleAgent(llmClient, 'db-123');
    await agent(createMockMessage('일정 보여줘'), mockSay);

    // classify(call[0]) + agent round 1(call[1]) + agent round 2(call[2])
    const agentSecondCallMessages = (llmClient.chat as ReturnType<typeof vi.fn>).mock.calls[2][0] as Array<{
      role: string;
      content: string;
    }>;
    const toolResultMessage = agentSecondCallMessages.find(
      (m) => m.role === 'tool',
    );
    expect(toolResultMessage?.content).toContain('도구 실행 오류');
    expect(toolResultMessage?.content).toContain('Notion API 오류');
    expect(mockSay).toHaveBeenCalledWith('Notion 연결에 문제가 있습니다.');
  });

  it('MAX_TOOL_ROUNDS 초과 시 안전 종료 메시지를 반환한다', async () => {
    mockedCallMCPTool.mockResolvedValue('{"results": []}');

    // classify(1) + agent loop(10회)
    const responses: LLMResponse[] = [
      CLASSIFY_ACTION,
      ...Array.from({ length: 11 }, () => ({
        text: null,
        toolCalls: [
          { id: 'call_loop', name: 'notion_search', arguments: {} },
        ],
        finishReason: 'tool_calls' as const,
      })),
    ];

    const llmClient = createMockLLMClient(responses);
    const agent = createScheduleAgent(llmClient, 'db-123');
    await agent(createMockMessage('복잡한 일정 요청'), mockSay);

    // classify(1) + agent(10)
    expect(llmClient.chat).toHaveBeenCalledTimes(11);
    expect(mockSay).toHaveBeenCalledWith(
      '요청이 너무 복잡해. 좀 더 간단하게 말해줘.',
    );
  });

  it('LLM 응답 text가 null이면 기본 메시지를 반환한다', async () => {
    const llmClient = createMockLLMClient([
      CLASSIFY_ACTION,
      { text: null, toolCalls: [], finishReason: 'stop' },
    ]);

    const agent = createScheduleAgent(llmClient, 'db-123');
    await agent(createMockMessage('오늘 일정 테스트'), mockSay);

    expect(mockSay).toHaveBeenCalledWith('처리했어.');
  });

  it('짧은 잡담은 도구 호출 없이 LLM 직접 응답한다', async () => {
    // '고마워'는 ACTION_KEYWORDS에 없으므로 키워드 빠른 경로로 casual 판별 (LLM 분류 불필요)
    const llmClient = createMockLLMClient([
      { text: '수고했어.', toolCalls: [], finishReason: 'stop' },
    ]);

    const agent = createScheduleAgent(llmClient, 'db-123');
    await agent(createMockMessage('고마워'), mockSay);

    // respondCasualChat(1) — 의도 분류는 키워드로 즉시 판별
    expect(llmClient.chat).toHaveBeenCalledTimes(1);
    const callArgs = (llmClient.chat as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs).toHaveLength(1); // messages만, tools 없음
    expect(mockSay).toHaveBeenCalledWith('수고했어.');
  });

  it('액션 키워드 있는 잡담은 LLM 1회로 분류+응답한다', async () => {
    // '내일 해보고 조정해봐야지' — '내일'이 ACTION_KEYWORDS에 있지만 잡담
    // classifyIntent가 분류+응답을 1회 LLM 호출로 처리
    const llmClient = createMockLLMClient([
      { text: '그래, 해봐.', toolCalls: [], finishReason: 'stop' }, // classify+respond
    ]);

    const agent = createScheduleAgent(llmClient, 'db-123');
    await agent(createMockMessage('내일 해보고 조정해봐야지'), mockSay);

    // LLM 1회만 호출 (분류+응답 통합)
    expect(llmClient.chat).toHaveBeenCalledTimes(1);
    expect(mockSay).toHaveBeenCalledWith('그래, 해봐.');
  });

  it('LLM 호출 자체가 실패하면 에러 메시지를 Slack에 전송한다', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const llmClient: LLMClient = {
      chat: vi.fn().mockRejectedValue(new Error('API 연결 실패')),
    };

    const agent = createScheduleAgent(llmClient, 'db-123');
    await agent(createMockMessage('일정 보여줘'), mockSay);

    // classifyIntent 실패 → 'action' 폴백 → agent loop 실패 → 에러 메시지
    expect(mockSay).toHaveBeenCalledWith(
      '일시적인 오류가 발생했어. 다시 한번 말해줘.',
    );
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
