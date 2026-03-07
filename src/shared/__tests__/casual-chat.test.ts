import { describe, it, expect, vi } from 'vitest';
import { isCasualChat, classifyIntent, classifyMessage, respondCasualChat } from '../casual-chat.js';
import type { LLMClient } from '../llm.js';

const ACTION_KEYWORDS = ['추가', '삭제', '일정', '보여', '알려', '오늘', '내일'];
const AGENT_CONTEXT = '일정 관리 에이전트. 일정 추가/삭제/조회 요청이면 action.';
const AGENT_ROLE = '너는 잔소리꾼이야.';

const createMockLLM = (text: string | null): LLMClient => ({
  chat: vi.fn().mockResolvedValue({
    text,
    toolCalls: [],
    finishReason: 'stop',
  }),
});

describe('isCasualChat', () => {
  it('짧고 키워드 없는 메시지는 잡담이다', () => {
    expect(isCasualChat('고마워', ACTION_KEYWORDS, 60)).toBe(true);
    expect(isCasualChat('알겠어', ACTION_KEYWORDS, 60)).toBe(true);
    expect(isCasualChat('잘 할게', ACTION_KEYWORDS, 60)).toBe(true);
  });

  it('액션 키워드가 포함되면 잡담이 아니다', () => {
    expect(isCasualChat('일정 보여줘', ACTION_KEYWORDS, 60)).toBe(false);
    expect(isCasualChat('내일 뭐 있어?', ACTION_KEYWORDS, 60)).toBe(false);
    expect(isCasualChat('추가해줘', ACTION_KEYWORDS, 60)).toBe(false);
  });

  it('maxLength 초과 메시지는 잡담이 아니다', () => {
    const longText = '아 진짜 오랜만이다 요즘 어떻게 지내고 있어 나는 좀 바빴거든';
    expect(isCasualChat(longText, ACTION_KEYWORDS, 10)).toBe(false);
  });

  it('maxLength 이하이고 키워드 없으면 잡담이다', () => {
    expect(isCasualChat('ㅋㅋ', ACTION_KEYWORDS, 60)).toBe(true);
  });

  it('빈 키워드 배열이면 항상 잡담 (길이만 체크)', () => {
    expect(isCasualChat('일정 보여줘', [], 60)).toBe(true);
    expect(isCasualChat('일정 보여줘', [], 5)).toBe(false);
  });

  it('casualOverrides만 매칭되면 잡담이다 (actionKeyword 없음)', () => {
    const overrides = ['화이팅', '해볼게', '고마워'];
    expect(isCasualChat('화이팅 해볼게', ACTION_KEYWORDS, 60, overrides)).toBe(true);
    expect(isCasualChat('고마워 정말', ACTION_KEYWORDS, 60, overrides)).toBe(true);
  });

  it('casualOverrides + actionKeyword 동시 매칭 → LLM 판별 필요 (잡담 아님)', () => {
    const overrides = ['화이팅', '해볼게', '고마워'];
    // '내일'이 actionKeyword, '화이팅'이 casualOverride → 둘 다 매칭 → false (LLM 판별)
    expect(isCasualChat('내일부터 화이팅 해볼게', ACTION_KEYWORDS, 60, overrides)).toBe(false);
    // '오늘'이 actionKeyword, '고마워'가 casualOverride → 둘 다 매칭 → false
    expect(isCasualChat('오늘 고마워', ACTION_KEYWORDS, 60, overrides)).toBe(false);
  });

  it('casualOverrides 없이 키워드 있으면 잡담이 아니다', () => {
    expect(isCasualChat('내일부터 화이팅 해볼게', ACTION_KEYWORDS, 60)).toBe(false);
  });
});

describe('classifyIntent (분류 + 응답)', () => {
  it('LLM이 casual 응답을 반환하면 intent=casual + casualReply 포함', async () => {
    const llm = createMockLLM('그래, 힘내봐.');
    const result = await classifyIntent(llm, '루틴 잘 지켜봐야지..', AGENT_CONTEXT, AGENT_ROLE);
    expect(result.intent).toBe('casual');
    expect(result.casualReply).toBe('그래, 힘내봐.');
  });

  it('LLM이 정확히 "action"을 반환하면 intent=action', async () => {
    const llm = createMockLLM('action');
    const result = await classifyIntent(llm, '내일 일정 추가해줘', AGENT_CONTEXT, AGENT_ROLE);
    expect(result.intent).toBe('action');
    expect(result.casualReply).toBeUndefined();
  });

  it('LLM 응답이 null이면 안전하게 action', async () => {
    const llm = createMockLLM(null);
    const result = await classifyIntent(llm, '테스트', AGENT_CONTEXT, AGENT_ROLE);
    expect(result.intent).toBe('action');
  });

  it('LLM 호출 실패 시 안전하게 action', async () => {
    const llm: LLMClient = {
      chat: vi.fn().mockRejectedValue(new Error('API 오류')),
    };
    const result = await classifyIntent(llm, '테스트', AGENT_CONTEXT, AGENT_ROLE);
    expect(result.intent).toBe('action');
  });

  it('시스템 프롬프트에 agentContext와 role이 포함된다', async () => {
    const llm = createMockLLM('그래.');
    await classifyIntent(llm, '테스트', AGENT_CONTEXT, AGENT_ROLE);

    const messages = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{
      role: string;
      content: string;
    }>;
    expect(messages[0].content).toContain(AGENT_CONTEXT);
    expect(messages[0].content).toContain(AGENT_ROLE);
  });
});

describe('classifyMessage (하이브리드)', () => {
  it('긴 메시지 → 즉시 action (LLM 호출 없음)', async () => {
    const llm = createMockLLM('그래.');
    const result = await classifyMessage(llm, '아주 긴 메시지', ACTION_KEYWORDS, 5, AGENT_CONTEXT, AGENT_ROLE);
    expect(result.intent).toBe('action');
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('casualOverrides만 매칭 (actionKeyword 없음) → 즉시 casual (LLM 호출 없음)', async () => {
    const llm = createMockLLM('action');
    const overrides = ['화이팅', '고마워'];
    const result = await classifyMessage(llm, '고마워 정말', ACTION_KEYWORDS, 80, AGENT_CONTEXT, AGENT_ROLE, overrides);
    expect(result.intent).toBe('casual');
    expect(result.casualReply).toBeUndefined();
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('casualOverrides + actionKeyword 동시 매칭 → LLM 분류', async () => {
    const llm = createMockLLM('괜찮아, 잘 하고 있어.');
    const overrides = ['화이팅', '고마워'];
    // '오늘'이 actionKeyword, '고마워'가 casualOverride → LLM 분류
    const result = await classifyMessage(llm, '오늘 고마워', ACTION_KEYWORDS, 80, AGENT_CONTEXT, AGENT_ROLE, overrides);
    expect(result.intent).toBe('casual');
    expect(result.casualReply).toBe('괜찮아, 잘 하고 있어.');
    expect(llm.chat).toHaveBeenCalledTimes(1);
  });

  it('액션 키워드 없음 → 즉시 casual, casualReply 없음 (LLM 호출 없음)', async () => {
    const llm = createMockLLM('action');
    const result = await classifyMessage(llm, 'ㅋㅋ', ACTION_KEYWORDS, 80, AGENT_CONTEXT, AGENT_ROLE);
    expect(result.intent).toBe('casual');
    expect(result.casualReply).toBeUndefined();
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('액션 키워드만 매칭 (casualOverride 없음) → 즉시 action (LLM 호출 없음)', async () => {
    const llm = createMockLLM('그래, 해봐.');
    const result = await classifyMessage(llm, '일정 잘 지켜봐야지..', ACTION_KEYWORDS, 80, AGENT_CONTEXT, AGENT_ROLE);
    expect(result.intent).toBe('action');
    expect(result.casualReply).toBeUndefined();
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('액션 키워드만 여러 개 매칭 → 즉시 action (LLM 호출 없음)', async () => {
    const llm = createMockLLM('action');
    const result = await classifyMessage(llm, '내일 일정 보여줘', ACTION_KEYWORDS, 80, AGENT_CONTEXT, AGENT_ROLE);
    expect(result.intent).toBe('action');
    expect(result.casualReply).toBeUndefined();
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('LLM 분류 실패 시 안전하게 action', async () => {
    const llm: LLMClient = {
      chat: vi.fn().mockRejectedValue(new Error('timeout')),
    };
    const result = await classifyMessage(llm, '내일 해보자', ACTION_KEYWORDS, 80, AGENT_CONTEXT, AGENT_ROLE);
    expect(result.intent).toBe('action');
  });
});

describe('respondCasualChat', () => {
  it('LLM 응답을 반환한다', async () => {
    const llmClient = createMockLLM('수고했어.');

    const result = await respondCasualChat(llmClient, '고마워', '너는 잔소리꾼이야.');
    expect(result).toBe('수고했어.');
    expect(llmClient.chat).toHaveBeenCalledTimes(1);

    // tools 인자 없이 호출
    const callArgs = (llmClient.chat as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs).toHaveLength(1);
  });

  it('LLM 응답 text가 null이면 폴백 메시지를 반환한다', async () => {
    const llmClient = createMockLLM(null);

    const result = await respondCasualChat(llmClient, '고마워', '너는 잔소리꾼이야.');
    expect(result).toBe('알겠어.');
  });

  it('LLM 호출 실패 시 1회 재시도 후 폴백 메시지를 반환한다', async () => {
    const llmClient: LLMClient = {
      chat: vi.fn().mockRejectedValue(new Error('API 오류')),
    };

    const result = await respondCasualChat(llmClient, '고마워', '너는 잔소리꾼이야.');
    expect(result).toBe('알겠어.');
    // 1회 시도 + 1회 재시도 = 2회 호출
    expect(llmClient.chat).toHaveBeenCalledTimes(2);
  });

  it('첫 시도 실패 후 재시도에서 성공하면 응답을 반환한다', async () => {
    const llmClient: LLMClient = {
      chat: vi.fn()
        .mockRejectedValueOnce(new Error('일시적 오류'))
        .mockResolvedValueOnce({ text: '힘내, 잘 자.', toolCalls: [], finishReason: 'stop' }),
    };

    const result = await respondCasualChat(llmClient, '잘 자', '너는 잔소리꾼이야.');
    expect(result).toBe('힘내, 잘 자.');
    expect(llmClient.chat).toHaveBeenCalledTimes(2);
  });

  it('시스템 프롬프트에 role이 포함된다', async () => {
    const llmClient = createMockLLM('잘 자.');

    await respondCasualChat(llmClient, '잘 자', '너는 루틴 관리 봇이야.');

    const messages = (llmClient.chat as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{
      role: string;
      content: string;
    }>;
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('너는 루틴 관리 봇이야.');
    expect(messages[1]).toEqual({ role: 'user', content: '잘 자' });
  });
});
