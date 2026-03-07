import { describe, it, expect, vi } from 'vitest';
import { generateGreeting } from '../cron-greeting.js';
import type { LLMClient } from '../llm.js';

const createMockLLM = (text: string | null): LLMClient => ({
  chat: vi.fn().mockResolvedValue({
    text,
    toolCalls: [],
    finishReason: 'stop',
  }),
});

describe('generateGreeting', () => {
  it('LLM 응답을 반환한다', async () => {
    const llm = createMockLLM('오늘도 힘내봐.');
    const result = await generateGreeting(llm, '인사해줘', '폴백 메시지');
    expect(result).toBe('오늘도 힘내봐.');
  });

  it('LLM 응답이 null이면 폴백을 반환한다', async () => {
    const llm = createMockLLM(null);
    const result = await generateGreeting(llm, '인사해줘', '폴백 메시지');
    expect(result).toBe('폴백 메시지');
  });

  it('LLM 호출 실패 시 폴백을 반환한다', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const llm: LLMClient = {
      chat: vi.fn().mockRejectedValue(new Error('API 오류')),
    };

    const result = await generateGreeting(llm, '인사해줘', '폴백 메시지');
    expect(result).toBe('폴백 메시지');
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('시스템 프롬프트에 잔소리꾼 성격이 포함된다', async () => {
    const llm = createMockLLM('잘 자.');
    await generateGreeting(llm, '인사해줘', '폴백');

    const messages = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{
      role: string;
      content: string;
    }>;
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('잔소리꾼');
    expect(messages[1]).toEqual({ role: 'user', content: '인사해줘' });
  });

  it('tools 없이 호출된다 (인사는 도구 불필요)', async () => {
    const llm = createMockLLM('잘 해봐.');
    await generateGreeting(llm, '인사해줘', '폴백');

    const callArgs = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs).toHaveLength(1); // messages만, tools 없음
  });
});
