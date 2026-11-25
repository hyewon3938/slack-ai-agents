import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { runAgentLoop } from '../agent-loop.js';
import { MAX_TOOL_ROUNDS } from '../agent-loop/types.js';
import type { AgentLoopConfig, ToolExecutor } from '../agent-loop/types.js';
import type { LLMClient, LLMMessage, LLMResponse, LLMToolDefinition } from '../llm.js';

// ─── 헬퍼 ───────────────────────────────────────────────

const TOOL: LLMToolDefinition = {
  name: 'query_db',
  description: '조회',
  inputSchema: { type: 'object', properties: {} },
};

type Step = LLMResponse | Error | 'hang';

interface ScriptedLLM {
  client: LLMClient;
  chat: Mock;
  /** chat 호출 시점의 messages 사본 (루프가 배열을 계속 변경하므로 사본으로 보관) */
  calls: LLMMessage[][];
}

/** steps를 순서대로 돌려주는 LLM. 마지막 step은 이후 호출에서 반복된다. */
const scriptedLLM = (steps: Step[]): ScriptedLLM => {
  const calls: LLMMessage[][] = [];
  let index = 0;
  const chat = vi.fn(async (messages: LLMMessage[]): Promise<LLMResponse> => {
    calls.push(messages.map((m) => ({ ...m })));
    const step = steps[Math.min(index, steps.length - 1)];
    index++;
    if (step === 'hang') return new Promise<never>(() => {});
    if (step instanceof Error) throw step;
    if (!step) throw new Error('step 없음');
    return step;
  });
  return { client: { chat }, chat, calls };
};

const stop = (text: string | null): LLMResponse => ({
  text,
  toolCalls: [],
  finishReason: 'stop',
});

const toolCall = (id: string, args: Record<string, unknown> = {}): LLMResponse => ({
  text: null,
  toolCalls: [{ id, name: 'query_db', arguments: args }],
  finishReason: 'tool_calls',
});

const makeConfig = (
  executeToolCall: ToolExecutor = vi.fn(async () => '[]'),
  overrides: Partial<AgentLoopConfig> = {},
): AgentLoopConfig => ({
  label: 'Test',
  buildSystemPrompt: () => 'SYSTEM',
  getTools: async () => [TOOL],
  executeToolCall,
  ...overrides,
});

const toolMessages = (messages: LLMMessage[]): LLMMessage[] =>
  messages.filter((m) => m.role === 'tool');

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ─── 기본 흐름 ──────────────────────────────────────────

describe('runAgentLoop 기본 흐름', () => {
  it('시스템 프롬프트, 히스토리, 사용자 메시지 순으로 첫 호출을 구성한다', async () => {
    const llm = scriptedLLM([stop('안녕')]);
    await runAgentLoop(
      llm.client,
      '반가워',
      makeConfig(undefined, {
        historyMessages: [
          { role: 'user', content: '이전 질문' },
          { role: 'assistant', content: '이전 답변' },
        ],
      }),
    );

    expect(llm.calls[0]).toEqual([
      { role: 'system', content: 'SYSTEM' },
      { role: 'user', content: '이전 질문' },
      { role: 'assistant', content: '이전 답변' },
      { role: 'user', content: '반가워' },
    ]);
    expect(llm.chat.mock.calls[0]?.[1]).toEqual([TOOL]);
  });

  it('도구 결과를 toolCallId와 함께 다음 호출에 넘기고, 호출한 도구와 인자를 결과에 담는다', async () => {
    const executor = vi.fn(async () => '[{"id":1}]');
    const llm = scriptedLLM([toolCall('call_1', { sql: 'SELECT 1' }), stop('1개 있어')]);

    const result = await runAgentLoop(llm.client, '일정 보여줘', makeConfig(executor));

    expect(executor).toHaveBeenCalledWith('query_db', { sql: 'SELECT 1' });
    expect(toolMessages(llm.calls[1] ?? [])).toEqual([
      { role: 'tool', content: '[{"id":1}]', toolCallId: 'call_1' },
    ]);
    expect(result).toEqual({
      text: '1개 있어',
      toolNames: ['query_db'],
      toolArgs: [{ sql: 'SELECT 1' }],
    });
  });

  it('도구가 throw하면 "도구 실행 오류:" 결과를 모델에 넘기고 루프를 이어간다', async () => {
    const executor = vi.fn(async () => {
      throw new Error('DB 연결 끊김');
    });
    const llm = scriptedLLM([toolCall('call_1'), stop('다시 해볼게')]);

    const result = await runAgentLoop(llm.client, '일정 보여줘', makeConfig(executor));

    const [toolMessage] = toolMessages(llm.calls[1] ?? []);
    expect(toolMessage?.content).toBe('도구 실행 오류: DB 연결 끊김');
    expect(toolMessage?.toolCallId).toBe('call_1');
    expect(llm.chat).toHaveBeenCalledTimes(2);
    expect(result.text).toBe('다시 해볼게');
  });

  it('도구 결과에 __earlyExit 마커가 있으면 LLM을 다시 부르지 않고 종료한다', async () => {
    const executor = vi.fn(async () => '{"__earlyExit":true}');
    const llm = scriptedLLM([toolCall('call_1'), stop('여기까지 오면 안 됨')]);

    const result = await runAgentLoop(llm.client, '기록해줘', makeConfig(executor));

    expect(llm.chat).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      text: '',
      toolNames: ['query_db'],
      toolArgs: [{}],
      earlyExit: true,
    });
  });

  it(`도구 호출이 ${MAX_TOOL_ROUNDS}라운드를 넘기면 정해진 안내로 끝낸다`, async () => {
    const llm = scriptedLLM([toolCall('call_loop')]);

    const result = await runAgentLoop(llm.client, '일정 보여줘', makeConfig());

    expect(llm.chat).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS);
    expect(result.text).toBe('요청이 너무 복잡해. 좀 더 간단하게 말해줘.');
    expect(result.toolNames).toHaveLength(MAX_TOOL_ROUNDS);
  });
});

// ─── 도구 미사용 환각 ───────────────────────────────────

describe('runAgentLoop 도구 미사용 환각 재시도', () => {
  it('도구 없이 완료를 주장하면 재촉 메시지를 붙여 한 번 다시 부른다', async () => {
    const llm = scriptedLLM([stop('추가했어'), toolCall('call_1'), stop('진짜 추가했어')]);

    const result = await runAgentLoop(llm.client, '일정 추가해줘', makeConfig());

    const retryMessages = llm.calls[1] ?? [];
    expect(retryMessages.at(-2)).toEqual({ role: 'assistant', content: '추가했어' });
    expect(retryMessages.at(-1)?.role).toBe('user');
    expect(retryMessages.at(-1)?.content).toContain('도구를 호출해야 해');
    expect(result.text).toBe('진짜 추가했어');
  });

  it('재시도 후에도 도구 없이 완료를 주장하면 더 재시도하지 않고 그 응답을 돌려준다', async () => {
    const llm = scriptedLLM([stop('추가했어'), stop('정말 추가했어')]);

    const result = await runAgentLoop(llm.client, '일정 추가해줘', makeConfig());

    expect(llm.chat).toHaveBeenCalledTimes(2);
    expect(result.text).toBe('정말 추가했어');
    expect(result.toolNames).toEqual([]);
  });
});

// ─── LLM 오류 ───────────────────────────────────────────

describe('runAgentLoop LLM 오류 처리', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  /** 대기 타이머를 모두 흘려보내며 루프를 끝까지 실행 */
  const runToEnd = async (llm: ScriptedLLM, config = makeConfig()): Promise<string> => {
    const pending = runAgentLoop(llm.client, '일정 보여줘', config);
    await vi.runAllTimersAsync();
    return (await pending).text;
  };

  it('402 오류는 재시도 없이 크레딧 안내를 돌려준다', async () => {
    const llm = scriptedLLM([new Error('402 Payment Required')]);

    const text = await runToEnd(llm);

    expect(llm.chat).toHaveBeenCalledTimes(1);
    expect(text).toContain('크레딧이 부족');
  });

  it('상태 코드가 400이어도 billing 안내가 담긴 크레딧 오류는 크레딧 안내로 분류한다', async () => {
    const llm = scriptedLLM([
      new Error(
        '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}',
      ),
    ]);

    const text = await runToEnd(llm);

    expect(llm.chat).toHaveBeenCalledTimes(1);
    expect(text).toContain('크레딧이 부족');
  });

  it('429 오류는 3번까지 재시도하고 그래도 실패하면 한도 초과 안내를 돌려준다', async () => {
    const llm = scriptedLLM([new Error('429 rate_limit_error')]);

    const text = await runToEnd(llm);

    expect(llm.chat).toHaveBeenCalledTimes(4);
    expect(text).toBe('API 호출 한도를 초과했어. 잠시 후에 다시 말해줘.');
  });

  it('429 오류 메시지의 "retry in Xs"만큼 기다린 뒤 다시 부른다', async () => {
    const llm = scriptedLLM([new Error('429 quota exceeded. Please retry in 12.5s'), stop('됐어')]);

    const pending = runAgentLoop(llm.client, '일정 보여줘', makeConfig());
    await vi.advanceTimersByTimeAsync(12_499);
    expect(llm.chat).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(llm.chat).toHaveBeenCalledTimes(2);
    expect((await pending).text).toBe('됐어');
  });

  it('일시 오류(503)는 2번까지 재시도하고 그래도 실패하면 일반 오류 안내를 돌려준다', async () => {
    const llm = scriptedLLM([new Error('503 overloaded')]);

    const text = await runToEnd(llm);

    expect(llm.chat).toHaveBeenCalledTimes(3);
    expect(text).toBe('일시적인 오류가 발생했어. 다시 한번 말해줘.');
  });

  it('일시 오류가 아닌 오류는 재시도하지 않는다', async () => {
    const llm = scriptedLLM([new Error('400 invalid_request_error: roles must alternate')]);

    const text = await runToEnd(llm);

    expect(llm.chat).toHaveBeenCalledTimes(1);
    expect(text).toBe('일시적인 오류가 발생했어. 다시 한번 말해줘.');
  });

  it('LLM이 60초 안에 응답하지 않으면 타임아웃 오류로 보고 재시도한다', async () => {
    const llm = scriptedLLM(['hang', stop('늦었지만 왔어')]);

    const text = await runToEnd(llm);

    expect(llm.chat).toHaveBeenCalledTimes(2);
    expect(text).toBe('늦었지만 왔어');
  });

  it('도구 호출이 성공하면 재시도 횟수를 다시 센다', async () => {
    const transient = new Error('503 overloaded');
    const llm = scriptedLLM([
      transient,
      toolCall('call_1'),
      transient,
      transient,
      stop('끝'),
    ]);

    const text = await runToEnd(llm);

    expect(llm.chat).toHaveBeenCalledTimes(5);
    expect(text).toBe('끝');
  });
});
