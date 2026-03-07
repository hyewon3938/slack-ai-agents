import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LLMClient, LLMResponse } from '../llm.js';
import { runAgentLoopWithAck, ACK_DELAY_MS } from '../agent-loop.js';
import type { AgentLoopConfig } from '../agent-loop.js';

vi.mock('../mcp-client.js', () => ({
  getMCPTools: vi.fn(() => []),
  callMCPTool: vi.fn(),
}));

const createFastLLMClient = (text: string): LLMClient => ({
  chat: vi.fn(async (): Promise<LLMResponse> => ({
    text,
    toolCalls: [],
    finishReason: 'stop',
  })),
});

const createSlowLLMClient = (text: string, delayMs: number): LLMClient => ({
  chat: vi.fn(async (): Promise<LLMResponse> => {
    await new Promise((r) => setTimeout(r, delayMs));
    return { text, toolCalls: [], finishReason: 'stop' };
  }),
});

const baseConfig: AgentLoopConfig = {
  label: 'Test Agent',
  buildSystemPrompt: () => 'test prompt',
  getTools: async () => [],
};

describe('ACK_DELAY_MS', () => {
  it('기본값은 800ms이다', () => {
    expect(ACK_DELAY_MS).toBe(800);
  });
});

describe('runAgentLoopWithAck', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('빠른 응답 시 ack를 전송하지 않는다', async () => {
    const llmClient = createFastLLMClient('응, 힘내.');
    const sendAck = vi.fn().mockResolvedValue(undefined);

    const resultPromise = runAgentLoopWithAck(llmClient, 'test', baseConfig, sendAck);

    // LLM이 즉시 반환 → microtask로 처리
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(sendAck).not.toHaveBeenCalled();
    expect(result.text).toBe('응, 힘내.');
  });

  it('느린 응답 시 ack를 전송한다', async () => {
    const llmClient = createSlowLLMClient('처리했어.', 2000);
    const sendAck = vi.fn().mockResolvedValue(undefined);

    const resultPromise = runAgentLoopWithAck(llmClient, 'test', baseConfig, sendAck, 100);

    // 100ms 경과 → ack 타이머 발동
    await vi.advanceTimersByTimeAsync(100);
    expect(sendAck).toHaveBeenCalledTimes(1);

    // LLM 응답 완료 대기
    await vi.advanceTimersByTimeAsync(2000);
    const result = await resultPromise;

    expect(result.text).toBe('처리했어.');
  });

  it('커스텀 delay를 지원한다', async () => {
    const llmClient = createSlowLLMClient('처리했어.', 500);
    const sendAck = vi.fn().mockResolvedValue(undefined);

    const resultPromise = runAgentLoopWithAck(llmClient, 'test', baseConfig, sendAck, 200);

    // 200ms 경과 → ack 발동
    await vi.advanceTimersByTimeAsync(200);
    expect(sendAck).toHaveBeenCalledTimes(1);

    // LLM 응답 완료
    await vi.advanceTimersByTimeAsync(500);
    const result = await resultPromise;

    expect(result.text).toBe('처리했어.');
  });

  it('ack 전송 중이면 완료까지 대기한다 (메시지 순서 보장)', async () => {
    const llmClient = createSlowLLMClient('처리했어.', 200);

    const ackOrder: string[] = [];
    const sendAck = vi.fn(async () => {
      // ack 전송에 50ms 소요
      await new Promise((r) => setTimeout(r, 50));
      ackOrder.push('ack_done');
    });

    const resultPromise = runAgentLoopWithAck(llmClient, 'test', baseConfig, sendAck, 100);

    // 100ms → ack 시작
    await vi.advanceTimersByTimeAsync(100);
    expect(sendAck).toHaveBeenCalledTimes(1);

    // 나머지 시간 처리
    await vi.advanceTimersByTimeAsync(200);
    await resultPromise;

    // ack가 완료된 후 결과 반환
    expect(ackOrder).toContain('ack_done');
  });

  it('AgentLoopResult 형태를 올바르게 반환한다', async () => {
    const llmClient = createFastLLMClient('응답 텍스트');
    const sendAck = vi.fn().mockResolvedValue(undefined);

    const resultPromise = runAgentLoopWithAck(llmClient, 'test', baseConfig, sendAck);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toHaveProperty('text');
    expect(result).toHaveProperty('toolNames');
    expect(result).toHaveProperty('toolArgs');
    expect(result.text).toBe('응답 텍스트');
    expect(result.toolNames).toEqual([]);
    expect(result.toolArgs).toEqual([]);
  });
});
