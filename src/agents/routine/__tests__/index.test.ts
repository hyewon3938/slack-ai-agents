import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { KnownEventFromType, SayFn } from '@slack/bolt';
import type { LLMClient, LLMResponse } from '../../../shared/llm.js';
import type { Client as NotionClient } from '@notionhq/client';
import { createRoutineAgent, detectTomorrowRoutine, detectChecklistTarget } from '../index.js';

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

vi.mock('../../../shared/routine-notion.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/routine-notion.js')>();
  return {
    ...actual,
    queryTodayRoutineRecords: vi.fn(),
    queryRoutineTemplates: vi.fn(async () => []),
    queryLastRecordDate: vi.fn(async () => undefined),
  };
});

const { queryTodayRoutineRecords, queryRoutineTemplates, queryLastRecordDate } = await import(
  '../../../shared/routine-notion.js'
);
const mockedQueryRecords = vi.mocked(queryTodayRoutineRecords);
const mockedQueryTemplates = vi.mocked(queryRoutineTemplates);
const mockedQueryLastDate = vi.mocked(queryLastRecordDate);

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

describe('detectChecklistTarget', () => {
  it('정확 매칭은 all을 반환한다', () => {
    expect(detectChecklistTarget('루틴')).toBe('all');
    expect(detectChecklistTarget('체크')).toBe('all');
  });

  it('시간대 포함 시 해당 시간대를 반환한다', () => {
    expect(detectChecklistTarget('아침 루틴')).toBe('아침');
    expect(detectChecklistTarget('저녁 루틴 보여줘')).toBe('저녁');
  });

  it('CRUD 키워드가 있으면 null을 반환한다', () => {
    expect(detectChecklistTarget('루틴 추가해줘')).toBeNull();
    expect(detectChecklistTarget('루틴 삭제해줘')).toBeNull();
    expect(detectChecklistTarget('루틴 꺼줘')).toBeNull();
    expect(detectChecklistTarget('루틴 켜줘')).toBeNull();
  });

  it('날짜 키워드가 있으면 null을 반환한다', () => {
    expect(detectChecklistTarget('내일 루틴')).toBeNull();
    expect(detectChecklistTarget('어제 루틴')).toBeNull();
  });

  it('쓰기 요청은 체크리스트로 가면 안 된다', () => {
    expect(detectChecklistTarget('오늘 루틴에서 환기시키기 꺼줘')).toBeNull();
    expect(detectChecklistTarget('저녁 루틴 끄고 싶어')).toBeNull();
  });
});

describe('detectTomorrowRoutine', () => {
  it('내일 루틴 패턴을 감지한다', () => {
    expect(detectTomorrowRoutine('내일 루틴')).toBe(true);
    expect(detectTomorrowRoutine('내일 루틴 보여줘')).toBe(true);
    expect(detectTomorrowRoutine('내일 루틴 뭐야')).toBe(true);
  });

  it('CRUD 키워드가 있으면 false를 반환한다', () => {
    expect(detectTomorrowRoutine('내일 루틴 추가해줘')).toBe(false);
    expect(detectTomorrowRoutine('내일 루틴 삭제해줘')).toBe(false);
  });

  it('내일 또는 루틴이 없으면 false를 반환한다', () => {
    expect(detectTomorrowRoutine('루틴 보여줘')).toBe(false);
    expect(detectTomorrowRoutine('내일 일정')).toBe(false);
  });
});

describe('createRoutineAgent', () => {
  let mockSay: SayFn;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSay = vi.fn() as unknown as SayFn;
  });

  describe('키워드 빠른 경로', () => {
    it('"루틴" 입력 시 LLM 없이 체크리스트를 반환한다', async () => {
      mockedQueryRecords.mockResolvedValueOnce([
        { id: 'p1', title: '루틴A', date: '2026-03-06', completed: false, timeSlot: '아침', frequency: '매일' },
        { id: 'p2', title: '루틴B', date: '2026-03-06', completed: true, timeSlot: '아침', frequency: '매일' },
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
        { id: 'p1', title: '루틴A', date: '2026-03-06', completed: true, timeSlot: '아침', frequency: '매일' },
      ]);

      const llmClient = createMockLLMClient([]);
      const agent = createRoutineAgent(llmClient, 'db-123', mockNotionClient);
      await agent(createMockMessage('루틴'), mockSay);

      expect(mockSay).toHaveBeenCalledWith('오늘 루틴 전부 완료했어!');
    });
  });

  describe('내일 루틴 미리보기', () => {
    it('내일 루틴 조회 시 빈도 기반으로 템플릿을 필터링한다', async () => {
      mockedQueryTemplates.mockResolvedValueOnce([
        { id: 't1', title: '스트레칭', timeSlot: '아침', frequency: '매일' },
        { id: 't2', title: '독서', timeSlot: '밤', frequency: '매일' },
        { id: 't3', title: '헬스장', timeSlot: '저녁', frequency: '격일' },
      ]);
      // 헬스장(격일): 마지막 기록이 오늘 → 내일은 gap=1 → 실행 안 함
      mockedQueryLastDate.mockResolvedValueOnce(new Date().toISOString().slice(0, 10));

      const llmClient = createMockLLMClient([]);
      const agent = createRoutineAgent(llmClient, 'db-123', mockNotionClient);
      await agent(createMockMessage('내일 루틴 보여줘'), mockSay);

      expect(llmClient.chat).not.toHaveBeenCalled();
      const reply = (mockSay as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(reply).toContain('내일');
      expect(reply).toContain('스트레칭');
      expect(reply).toContain('독서');
      // 격일인데 오늘 했으면 내일은 안 나와야 함
      expect(reply).not.toContain('헬스장');
    });

    it('내일 루틴이 없으면 없다는 메시지를 반환한다', async () => {
      mockedQueryTemplates.mockResolvedValueOnce([]);

      const llmClient = createMockLLMClient([]);
      const agent = createRoutineAgent(llmClient, 'db-123', mockNotionClient);
      await agent(createMockMessage('내일 루틴'), mockSay);

      const reply = (mockSay as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(reply).toContain('내일');
      expect(reply).toContain('없어');
    });
  });

  describe('LLM 에이전트 경로', () => {
    it('자연어 요청은 LLM 에이전트 루프를 실행한다', async () => {
      const llmClient = createMockLLMClient([
        // round 0: 도구 없이 "추가했어" → 환각 가드 발동 → 재시도
        { text: '오전 루틴에 추가했어.', toolCalls: [], finishReason: 'stop' },
        // round 1: 환각 가드는 round 0만 체크 → 통과
        { text: '오전 루틴에 추가했어.', toolCalls: [], finishReason: 'stop' },
      ]);

      const agent = createRoutineAgent(llmClient, 'db-123', mockNotionClient);
      await agent(createMockMessage('스트레칭 오전에 추가해줘'), mockSay);

      // actionKeyword만 → 즉시 action (classify 없음) + agent(2: 환각 가드 재시도 포함)
      expect(llmClient.chat).toHaveBeenCalledTimes(2);
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
