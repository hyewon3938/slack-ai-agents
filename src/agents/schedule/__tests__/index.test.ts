import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { KnownEventFromType, SayFn } from '@slack/bolt';
import type { LLMClient, LLMResponse } from '../../../shared/llm.js';
import type { NotionClient, ScheduleItem } from '../../../shared/notion.js';
import { createScheduleAgent, detectSimpleQuery, detectBacklogQuery, extractMutationDate, extractDateFromToolArgs, isBacklogMutation } from '../index.js';

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

vi.mock('../../../shared/notion.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../shared/notion.js')>();
  return {
    ...original,
    queryTodaySchedules: vi.fn(async () => []),
    queryBacklogItems: vi.fn(async () => []),
  };
});

const { callMCPTool } = await import('../../../shared/mcp-client.js');
const mockedCallMCPTool = vi.mocked(callMCPTool);

const { queryTodaySchedules, queryBacklogItems } = await import('../../../shared/notion.js');
const mockedQuerySchedules = vi.mocked(queryTodaySchedules);
const mockedQueryBacklog = vi.mocked(queryBacklogItems);

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

describe('detectSimpleQuery', () => {
  it('오늘 일정 조회 패턴을 감지한다', () => {
    expect(detectSimpleQuery('오늘 일정')).toBe('today');
    expect(detectSimpleQuery('오늘 일정 보여줘')).toBe('today');
    expect(detectSimpleQuery('오늘 뭐 있어')).toBe('today');
    expect(detectSimpleQuery('일정 보여줘')).toBe('today');
    expect(detectSimpleQuery('일정 알려줘')).toBe('today');
  });

  it('어제 일정 조회 패턴을 감지한다', () => {
    expect(detectSimpleQuery('어제 일정')).toBe('yesterday');
    expect(detectSimpleQuery('어제 뭐 있었어')).toBe('yesterday');
    expect(detectSimpleQuery('어제 일정 보여줘')).toBe('yesterday');
  });

  it('내일/모레 패턴을 감지한다', () => {
    expect(detectSimpleQuery('내일 일정')).toBe('tomorrow');
    expect(detectSimpleQuery('내일 뭐 있어')).toBe('tomorrow');
    expect(detectSimpleQuery('모레 일정 보여줘')).toBe('dayAfter');
  });

  it('쓰기 키워드가 있으면 null을 반환한다', () => {
    expect(detectSimpleQuery('오늘 일정 추가해줘')).toBeNull();
    expect(detectSimpleQuery('일정 삭제해줘')).toBeNull();
    expect(detectSimpleQuery('일정 수정해줘')).toBeNull();
  });

  it('복잡한 조회는 null을 반환한다', () => {
    expect(detectSimpleQuery('이번주 일정')).toBeNull();
    expect(detectSimpleQuery('언제 약속이야')).toBeNull();
  });

  it('긴 메시지는 null을 반환한다', () => {
    expect(detectSimpleQuery('오늘 일정 중에서 중요한 것만 따로 정리해서 보여줘')).toBeNull();
  });

  it('조회 의도가 약하면 null을 반환한다', () => {
    expect(detectSimpleQuery('일정 검색해줘')).toBeNull();
    expect(detectSimpleQuery('좋은 아침')).toBeNull();
  });
});

describe('detectBacklogQuery', () => {
  it('백로그 조회 패턴을 감지한다', () => {
    expect(detectBacklogQuery('백로그')).toBe(true);
    expect(detectBacklogQuery('백로그 보여줘')).toBe(true);
    expect(detectBacklogQuery('백로그 목록')).toBe(true);
  });

  it('쓰기 키워드가 있으면 false를 반환한다', () => {
    expect(detectBacklogQuery('백로그 추가해줘')).toBe(false);
    expect(detectBacklogQuery('백로그 삭제해줘')).toBe(false);
  });

  it('백로그가 없으면 false를 반환한다', () => {
    expect(detectBacklogQuery('오늘 일정')).toBe(false);
  });

  it('긴 메시지는 false를 반환한다', () => {
    expect(detectBacklogQuery('백로그에서 내일로 옮겨줘 그거 중요한 거야')).toBe(false);
  });
});

describe('extractMutationDate', () => {
  const TODAY = '2026-03-07';

  it('어제/오늘/내일/모레 키워드를 인식한다', () => {
    expect(extractMutationDate('어제 미팅 완료', TODAY)).toBe('2026-03-06');
    expect(extractMutationDate('오늘 미팅 추가', TODAY)).toBe('2026-03-07');
    expect(extractMutationDate('내일 보고서 추가', TODAY)).toBe('2026-03-08');
    expect(extractMutationDate('모레 약속 추가', TODAY)).toBe('2026-03-09');
  });

  it('날짜 키워드 없으면 오늘로 기본 설정한다', () => {
    expect(extractMutationDate('미팅 추가해줘', TODAY)).toBe('2026-03-07');
  });

  it('복잡한 날짜 표현은 null을 반환한다', () => {
    expect(extractMutationDate('이번주 금요일에 추가', TODAY)).toBeNull();
    expect(extractMutationDate('다음주에 추가해줘', TODAY)).toBeNull();
    expect(extractMutationDate('월요일에 추가해줘', TODAY)).toBeNull();
    expect(extractMutationDate('3월 10일에 추가', TODAY)).toBeNull();
  });

  it('백로그 키워드가 있으면 null을 반환한다', () => {
    expect(extractMutationDate('백로그에 추가해줘', TODAY)).toBeNull();
    expect(extractMutationDate('백로그에 인스타 자동화 추가', TODAY)).toBeNull();
  });
});

describe('extractDateFromToolArgs', () => {
  it('API-post-page arguments에서 날짜를 추출한다', () => {
    const toolNames = ['API-post-page'];
    const toolArgs = [{
      parent: { database_id: 'db-123' },
      properties: {
        Name: { title: [{ text: { content: '미팅' } }] },
        Date: { date: { start: '2026-03-10' } },
        '상태': { select: { name: 'todo' } },
      },
    }];

    expect(extractDateFromToolArgs(toolNames, toolArgs)).toBe('2026-03-10');
  });

  it('API-patch-page arguments에서 날짜를 추출한다', () => {
    const toolNames = ['API-post-search', 'API-patch-page'];
    const toolArgs = [
      { query: '미팅' },
      {
        properties: {
          Date: { date: { start: '2026-03-15' } },
        },
      },
    ];

    expect(extractDateFromToolArgs(toolNames, toolArgs)).toBe('2026-03-15');
  });

  it('mutation 도구가 아닌 도구의 args는 무시한다', () => {
    const toolNames = ['API-post-search'];
    const toolArgs = [{
      query: '',
      filter: { property: 'Date', date: { start: '2026-03-10' } },
    }];

    expect(extractDateFromToolArgs(toolNames, toolArgs)).toBeNull();
  });

  it('날짜 속성이 없는 mutation은 null을 반환한다', () => {
    const toolNames = ['API-patch-page'];
    const toolArgs = [{
      properties: {
        '상태': { select: { name: 'done' } },
      },
    }];

    expect(extractDateFromToolArgs(toolNames, toolArgs)).toBeNull();
  });

  it('datetime 형식에서 날짜 부분만 추출한다', () => {
    const toolNames = ['API-post-page'];
    const toolArgs = [{
      parent: { database_id: 'db-123' },
      properties: {
        Date: { date: { start: '2026-03-10T14:00:00+09:00' } },
      },
    }];

    expect(extractDateFromToolArgs(toolNames, toolArgs)).toBe('2026-03-10');
  });

  it('빈 배열이면 null을 반환한다', () => {
    expect(extractDateFromToolArgs([], [])).toBeNull();
  });
});

describe('isBacklogMutation', () => {
  it('Date가 null인 API-post-page를 백로그로 감지한다', () => {
    const toolNames = ['API-post-page'];
    const toolArgs = [{
      parent: { database_id: 'db-123' },
      properties: {
        Name: { title: [{ text: { content: '인스타 자동화' } }] },
        Date: { date: null },
        '상태': { select: { name: 'todo' } },
      },
    }];

    expect(isBacklogMutation(toolNames, toolArgs)).toBe(true);
  });

  it('Date가 있는 API-post-page는 백로그가 아니다', () => {
    const toolNames = ['API-post-page'];
    const toolArgs = [{
      parent: { database_id: 'db-123' },
      properties: {
        Name: { title: [{ text: { content: '미팅' } }] },
        Date: { date: { start: '2026-03-10' } },
        '상태': { select: { name: 'todo' } },
      },
    }];

    expect(isBacklogMutation(toolNames, toolArgs)).toBe(false);
  });

  it('mutation 도구가 아닌 도구는 무시한다', () => {
    const toolNames = ['API-post-search'];
    const toolArgs = [{
      query: '',
      filter: { date: null },
    }];

    expect(isBacklogMutation(toolNames, toolArgs)).toBe(false);
  });

  it('여러 도구 중 하나라도 Date: null이면 백로그로 감지한다', () => {
    const toolNames = ['API-post-page', 'API-post-page'];
    const toolArgs = [
      {
        parent: { database_id: 'db-123' },
        properties: {
          Name: { title: [{ text: { content: '항목1' } }] },
          Date: { date: null },
        },
      },
      {
        parent: { database_id: 'db-123' },
        properties: {
          Name: { title: [{ text: { content: '항목2' } }] },
          Date: { date: null },
        },
      },
    ];

    expect(isBacklogMutation(toolNames, toolArgs)).toBe(true);
  });

  it('빈 배열이면 false를 반환한다', () => {
    expect(isBacklogMutation([], [])).toBe(false);
  });
});

describe('createScheduleAgent', () => {
  let mockSay: SayFn;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSay = vi.fn() as unknown as SayFn;
  });

  // --- "체크" 단축어 (Block Kit + overflow) ---

  it('"체크" 입력 시 Block Kit으로 오늘 일정을 반환한다', async () => {
    const mockItems: ScheduleItem[] = [
      { id: 'p1', title: '미팅', date: { start: '2026-03-07', end: null }, status: 'todo', category: [], hasStarIcon: false },
    ];
    mockedQuerySchedules.mockResolvedValueOnce(mockItems);

    const llmClient = createMockLLMClient([]);
    const agent = createScheduleAgent(llmClient, 'db-123', mockNotionClient);
    await agent(createMockMessage('체크'), mockSay);

    expect(llmClient.chat).not.toHaveBeenCalled();
    expect(mockSay).toHaveBeenCalledWith(
      expect.objectContaining({ blocks: expect.any(Array) }),
    );
  });

  it('"체크" 입력 시 일정이 없으면 텍스트 메시지를 반환한다', async () => {
    mockedQuerySchedules.mockResolvedValueOnce([]);

    const llmClient = createMockLLMClient([]);
    const agent = createScheduleAgent(llmClient, 'db-123', mockNotionClient);
    await agent(createMockMessage('체크'), mockSay);

    const reply = (mockSay as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(reply).toContain('없어');
  });

  // --- 조회 빠른 경로 ---

  it('오늘 일정 조회 시 SDK 직접 호출로 빠르게 응답한다', async () => {
    const mockItems: ScheduleItem[] = [
      { id: 'p1', title: '미팅', date: { start: '2025-03-07', end: null }, status: 'todo', category: ['약속'], hasStarIcon: false },
      { id: 'p2', title: '보고서 작성', date: { start: '2025-03-07', end: null }, status: 'todo', category: [], hasStarIcon: false },
    ];
    mockedQuerySchedules.mockResolvedValueOnce(mockItems);

    const llmClient = createMockLLMClient([]);

    const agent = createScheduleAgent(llmClient, 'db-123', mockNotionClient);
    await agent(createMockMessage('오늘 일정 보여줘'), mockSay);

    // queryTodaySchedules가 호출되었는지 확인
    expect(mockedQuerySchedules).toHaveBeenCalledTimes(1);
    // actionKeyword만 → 즉시 action + detectSimpleQuery → SDK 직접 (LLM 호출 없음)
    expect(llmClient.chat).not.toHaveBeenCalled();
    // 응답에 일정 항목이 포함
    const reply = (mockSay as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(reply).toContain('미팅');
    expect(reply).toContain('보고서 작성');
  });

  it('일정이 없으면 없다는 메시지를 반환한다', async () => {
    mockedQuerySchedules.mockResolvedValueOnce([]);

    const llmClient = createMockLLMClient([]);

    const agent = createScheduleAgent(llmClient, 'db-123', mockNotionClient);
    await agent(createMockMessage('오늘 일정'), mockSay);

    expect(mockedQuerySchedules).toHaveBeenCalledTimes(1);
    const reply = (mockSay as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(reply).toContain('일정');
    // "없어" or "없는" 포함
    expect(reply).toMatch(/없/);
  });

  // --- 백로그 빠른 경로 ---

  it('백로그 조회 시 SDK 직접 호출로 빠르게 응답한다', async () => {
    const mockItems: ScheduleItem[] = [
      { id: 'p1', title: '나중에 할 일', date: null, status: 'todo', category: [], hasStarIcon: false },
      { id: 'p2', title: '중요 백로그', date: null, status: 'todo', category: ['개발'], hasStarIcon: true },
    ];
    mockedQueryBacklog.mockResolvedValueOnce(mockItems);

    const llmClient = createMockLLMClient([]);

    const agent = createScheduleAgent(llmClient, 'db-123', mockNotionClient);
    await agent(createMockMessage('백로그 보여줘'), mockSay);

    expect(mockedQueryBacklog).toHaveBeenCalledTimes(1);
    expect(llmClient.chat).not.toHaveBeenCalled();
    const reply = (mockSay as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(reply).toContain('나중에 할 일');
    expect(reply).toContain('중요 백로그');
    expect(reply).toContain('[개발]');
    expect(reply).toContain('★');
    expect(reply).toContain('날짜 지정하고 싶은 거 있으면 말해줘');
  });

  it('백로그가 비어있으면 없다는 메시지를 반환한다', async () => {
    mockedQueryBacklog.mockResolvedValueOnce([]);

    const llmClient = createMockLLMClient([]);

    const agent = createScheduleAgent(llmClient, 'db-123', mockNotionClient);
    await agent(createMockMessage('백로그'), mockSay);

    expect(mockedQueryBacklog).toHaveBeenCalledTimes(1);
    const reply = (mockSay as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(reply).toContain('없');
  });

  // --- 에이전트 루프 ---

  it('tool call 1회 후 최종 응답을 반환한다', async () => {
    mockedCallMCPTool.mockResolvedValueOnce('{"results": []}');

    const llmClient = createMockLLMClient([
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

    const agent = createScheduleAgent(llmClient, 'db-123', mockNotionClient);
    await agent(createMockMessage('일정 검색해줘'), mockSay);

    expect(mockedCallMCPTool).toHaveBeenCalledWith('notion_search', { query: '일정' });
    expect(mockSay).toHaveBeenCalledWith('일정을 찾지 못했습니다.');
    // actionKeyword만 → 즉시 action (classify 없음) + agent(2)
    expect(llmClient.chat).toHaveBeenCalledTimes(2);
  });

  it('tool call 여러 회 연속 실행을 처리한다', async () => {
    mockedCallMCPTool
      .mockResolvedValueOnce('{"results": [{"id": "page-1"}]}')
      .mockResolvedValueOnce('{"ok": true}');

    const llmClient = createMockLLMClient([
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

    const agent = createScheduleAgent(llmClient, 'db-123', mockNotionClient);
    await agent(createMockMessage('미팅 일정 수정해줘'), mockSay);

    expect(mockedCallMCPTool).toHaveBeenCalledTimes(2);
    // actionKeyword만 → 즉시 action + agent(3)
    expect(llmClient.chat).toHaveBeenCalledTimes(3);
    expect(mockSay).toHaveBeenCalledWith('미팅 일정을 수정했습니다.');
  });

  it('tool call 실패 시 에러 메시지를 LLM에 전달한다', async () => {
    mockedCallMCPTool.mockRejectedValueOnce(new Error('Notion API 오류'));

    const llmClient = createMockLLMClient([
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

    const agent = createScheduleAgent(llmClient, 'db-123', mockNotionClient);
    await agent(createMockMessage('이번주 일정 보여줘'), mockSay);

    // actionKeyword만 → 즉시 action + agent round 1(call[0]) + agent round 2(call[1])
    const agentSecondCallMessages = (llmClient.chat as ReturnType<typeof vi.fn>).mock.calls[1][0] as Array<{
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

    // actionKeyword만 → 즉시 action + agent loop(10회)
    const responses: LLMResponse[] = Array.from({ length: 11 }, () => ({
      text: null,
      toolCalls: [
        { id: 'call_loop', name: 'notion_search', arguments: {} },
      ],
      finishReason: 'tool_calls' as const,
    }));

    const llmClient = createMockLLMClient(responses);
    const agent = createScheduleAgent(llmClient, 'db-123', mockNotionClient);
    await agent(createMockMessage('복잡한 일정 요청'), mockSay);

    // agent(10)만 — classify 호출 없음
    expect(llmClient.chat).toHaveBeenCalledTimes(10);
    expect(mockSay).toHaveBeenCalledWith(
      '요청이 너무 복잡해. 좀 더 간단하게 말해줘.',
    );
  });

  it('LLM 응답 text가 null이면 기본 메시지를 반환한다', async () => {
    const llmClient = createMockLLMClient([
      { text: null, toolCalls: [], finishReason: 'stop' },
    ]);

    const agent = createScheduleAgent(llmClient, 'db-123', mockNotionClient);
    await agent(createMockMessage('일정 정리해줘'), mockSay);

    expect(mockSay).toHaveBeenCalledWith('처리했어.');
  });

  // --- 잡담 ---

  it('짧은 잡담은 도구 호출 없이 LLM 직접 응답한다', async () => {
    const llmClient = createMockLLMClient([
      { text: '수고했어.', toolCalls: [], finishReason: 'stop' },
    ]);

    const agent = createScheduleAgent(llmClient, 'db-123', mockNotionClient);
    await agent(createMockMessage('고마워'), mockSay);

    // respondCasualChat(1)
    expect(llmClient.chat).toHaveBeenCalledTimes(1);
    const callArgs = (llmClient.chat as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs).toHaveLength(1); // messages만, tools 없음
    expect(mockSay).toHaveBeenCalledWith('수고했어.');
  });

  it('액션 키워드 있는 잡담은 LLM 1회로 분류+응답한다', async () => {
    const llmClient = createMockLLMClient([
      { text: '그래, 해봐.', toolCalls: [], finishReason: 'stop' },
    ]);

    const agent = createScheduleAgent(llmClient, 'db-123', mockNotionClient);
    await agent(createMockMessage('내일 해보고 조정해봐야지'), mockSay);

    expect(llmClient.chat).toHaveBeenCalledTimes(1);
    expect(mockSay).toHaveBeenCalledWith('그래, 해봐.');
  });

  // --- 에러 ---

  it('LLM 호출 자체가 실패하면 에러 메시지를 Slack에 전송한다', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const llmClient: LLMClient = {
      chat: vi.fn().mockRejectedValue(new Error('API 연결 실패')),
    };

    const agent = createScheduleAgent(llmClient, 'db-123', mockNotionClient);
    await agent(createMockMessage('이번주 일정 보여줘'), mockSay);

    expect(mockSay).toHaveBeenCalledWith(
      '일시적인 오류가 발생했어. 다시 한번 말해줘.',
    );
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
