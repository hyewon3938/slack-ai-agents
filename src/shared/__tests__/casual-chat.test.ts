import { describe, it, expect, vi } from 'vitest';
import { isCasualChat, respondCasualChat } from '../casual-chat.js';
import type { LLMClient } from '../llm.js';

const ACTION_KEYWORDS = ['추가', '삭제', '일정', '보여', '알려', '오늘', '내일'];

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

  it('casualOverrides 표현이 있으면 키워드 무관하게 잡담이다', () => {
    const overrides = ['화이팅', '해볼게', '고마워'];
    // '내일'은 ACTION_KEYWORDS에 있지만, '화이팅'이 overrides에 있으므로 잡담
    expect(isCasualChat('내일부터 화이팅 해볼게', ACTION_KEYWORDS, 60, overrides)).toBe(true);
    // '오늘'은 ACTION_KEYWORDS에 있지만, '고마워'가 overrides에 있으므로 잡담
    expect(isCasualChat('오늘 고마워', ACTION_KEYWORDS, 60, overrides)).toBe(true);
  });

  it('casualOverrides 없이 키워드 있으면 잡담이 아니다', () => {
    // overrides 없으면 기존 동작 유지
    expect(isCasualChat('내일부터 화이팅 해볼게', ACTION_KEYWORDS, 60)).toBe(false);
  });
});

describe('respondCasualChat', () => {
  it('LLM 응답을 반환한다', async () => {
    const llmClient: LLMClient = {
      chat: vi.fn().mockResolvedValue({
        text: '수고했어.',
        toolCalls: [],
        finishReason: 'stop',
      }),
    };

    const result = await respondCasualChat(llmClient, '고마워', '너는 잔소리꾼이야.');
    expect(result).toBe('수고했어.');
    expect(llmClient.chat).toHaveBeenCalledTimes(1);

    // tools 인자 없이 호출
    const callArgs = (llmClient.chat as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs).toHaveLength(1);
  });

  it('LLM 응답 text가 null이면 폴백 메시지를 반환한다', async () => {
    const llmClient: LLMClient = {
      chat: vi.fn().mockResolvedValue({
        text: null,
        toolCalls: [],
        finishReason: 'stop',
      }),
    };

    const result = await respondCasualChat(llmClient, '고마워', '너는 잔소리꾼이야.');
    expect(result).toBe('알겠어.');
  });

  it('LLM 호출 실패 시 폴백 메시지를 반환한다', async () => {
    const llmClient: LLMClient = {
      chat: vi.fn().mockRejectedValue(new Error('API 오류')),
    };

    const result = await respondCasualChat(llmClient, '고마워', '너는 잔소리꾼이야.');
    expect(result).toBe('알겠어.');
  });

  it('시스템 프롬프트에 role이 포함된다', async () => {
    const llmClient: LLMClient = {
      chat: vi.fn().mockResolvedValue({
        text: '잘 자.',
        toolCalls: [],
        finishReason: 'stop',
      }),
    };

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
