import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeToolCalls, handleToolCallsResponse } from '../tool-calls.js';
import { TOOL_TIMEOUT_MS } from '../types.js';
import type { LoopState, ToolExecutor } from '../types.js';
import type { LLMToolCall } from '../../llm.js';

// ─── 헬퍼 ───────────────────────────────────────────────

const call = (id: string, name = 'query_db'): LLMToolCall => ({ id, name, arguments: { id } });

const makeState = (): LoopState => ({
  messages: [],
  calledToolNames: [],
  calledToolArgs: [],
  retryCount: 2,
  hallucinationRetried: false,
});

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ─── executeToolCalls ───────────────────────────────────

describe('executeToolCalls', () => {
  it('늦게 끝난 도구가 있어도 결과를 호출 순서와 toolCallId에 맞춰 돌려준다', async () => {
    vi.useFakeTimers();
    const executor: ToolExecutor = (_name, args) =>
      new Promise((resolve) => {
        const delay = args.id === 'slow' ? 200 : 10;
        setTimeout(() => resolve(`결과:${String(args.id)}`), delay);
      });

    const pending = executeToolCalls([call('slow'), call('fast')], 'T', executor);
    await vi.advanceTimersByTimeAsync(200);

    expect(await pending).toEqual([
      { role: 'tool', content: '결과:slow', toolCallId: 'slow' },
      { role: 'tool', content: '결과:fast', toolCallId: 'fast' },
    ]);
  });

  it('한 도구가 실패해도 나머지 결과는 그대로 돌려준다', async () => {
    const executor: ToolExecutor = async (name) => {
      if (name === 'modify_db') throw new Error('권한 없음');
      return 'ok';
    };

    const results = await executeToolCalls(
      [call('a', 'modify_db'), call('b', 'query_db')],
      'T',
      executor,
    );

    expect(results.map((r) => r.content)).toEqual(['도구 실행 오류: 권한 없음', 'ok']);
  });

  it(`도구가 ${TOOL_TIMEOUT_MS / 1000}초 안에 끝나지 않으면 타임아웃 오류 결과로 바꾼다`, async () => {
    vi.useFakeTimers();
    const executor: ToolExecutor = () => new Promise<never>(() => {});

    const pending = executeToolCalls([call('a')], 'T', executor);
    await vi.advanceTimersByTimeAsync(TOOL_TIMEOUT_MS);

    expect((await pending)[0]?.content).toBe(
      `도구 실행 오류: 도구 query_db timeout (${TOOL_TIMEOUT_MS / 1000}s)`,
    );
  });
});

// ─── handleToolCallsResponse ────────────────────────────

describe('handleToolCallsResponse', () => {
  it('__earlyExit가 true가 아니거나 JSON이 아닌 결과로는 조기 종료하지 않는다', async () => {
    const results = ['{"__earlyExit":"true"}', '{"__earlyExit":false}', '__earlyExit'];
    const executor: ToolExecutor = async (_name, args) => results[Number(args.id)] ?? '';
    const state = makeState();

    const result = await handleToolCallsResponse(
      { text: null, toolCalls: [call('0'), call('1'), call('2')], finishReason: 'tool_calls' },
      'T',
      executor,
      state,
    );

    expect(result).toBeNull();
  });

  it('도구 호출 기록을 쌓고 재시도 횟수를 0으로 되돌린다', async () => {
    const state = makeState();

    await handleToolCallsResponse(
      { text: '조회할게', toolCalls: [call('x')], finishReason: 'tool_calls' },
      'T',
      async () => '[]',
      state,
    );

    expect(state.retryCount).toBe(0);
    expect(state.calledToolNames).toEqual(['query_db']);
    expect(state.calledToolArgs).toEqual([{ id: 'x' }]);
    expect(state.messages.map((m) => m.role)).toEqual(['assistant', 'tool']);
  });
});
