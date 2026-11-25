import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleAbnormalFinish, handleStopResponse } from '../responses.js';
import { MAX_RETRIES } from '../types.js';
import type { LoopState } from '../types.js';
import type { LLMResponse, LLMToolDefinition } from '../../llm.js';

// ─── 헬퍼 ───────────────────────────────────────────────

const TOOLS: LLMToolDefinition[] = [
  { name: 'modify_db', description: '변경', inputSchema: { type: 'object' } },
];

const makeState = (overrides: Partial<LoopState> = {}): LoopState => ({
  messages: [],
  calledToolNames: [],
  calledToolArgs: [],
  retryCount: 0,
  hallucinationRetried: false,
  ...overrides,
});

const response = (
  text: string | null,
  finishReason: LLMResponse['finishReason'] = 'stop',
): LLMResponse => ({ text, toolCalls: [], finishReason });

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── handleStopResponse ─────────────────────────────────

describe('handleStopResponse', () => {
  it('액션을 요청했는데 도구 없이 완료를 주장하면 재시도(null)하고 재시도 표시를 남긴다', () => {
    const state = makeState();

    const result = handleStopResponse(response('삭제했어'), '그 일정 삭제해줘', TOOLS, 'T', state);

    expect(result).toBeNull();
    expect(state.hallucinationRetried).toBe(true);
    expect(state.messages).toHaveLength(2);
  });

  it('응답 텍스트가 비어 있어도 액션 요청이면 환각으로 보고 재시도한다', () => {
    const state = makeState();

    const result = handleStopResponse(response(null), '루틴 기록해줘', TOOLS, 'T', state);

    expect(result).toBeNull();
    expect(state.messages[0]).toEqual({ role: 'assistant', content: '(도구 호출 없이 응답)' });
  });

  it('액션 요청이 아닌 대화는 완료 표현이 있어도 그대로 돌려준다', () => {
    const state = makeState();

    const result = handleStopResponse(response('나도 잘 잤어'), '잘 잤어?', TOOLS, 'T', state);

    expect(result?.text).toBe('나도 잘 잤어');
    expect(state.messages).toHaveLength(0);
  });

  it('이미 도구를 호출했으면 완료 주장을 그대로 믿는다', () => {
    const state = makeState({ calledToolNames: ['modify_db'], calledToolArgs: [{ sql: 'X' }] });

    const result = handleStopResponse(response('추가했어'), '일정 추가해줘', TOOLS, 'T', state);

    expect(result).toEqual({ text: '추가했어', toolNames: ['modify_db'], toolArgs: [{ sql: 'X' }] });
  });

  it('도구가 없는 에이전트는 환각 검사를 하지 않는다', () => {
    const state = makeState();

    const result = handleStopResponse(response('추가했어'), '일정 추가해줘', [], 'T', state);

    expect(result?.text).toBe('추가했어');
  });
});

// ─── handleAbnormalFinish ───────────────────────────────

describe('handleAbnormalFinish', () => {
  it(`finishReason error는 ${MAX_RETRIES}번까지 같은 호출을 재시도한다`, () => {
    const state = makeState({ retryCount: MAX_RETRIES - 1 });

    const result = handleAbnormalFinish(response(null, 'error'), 'T', state);

    expect(result).toBeNull();
    expect(state.retryCount).toBe(MAX_RETRIES);
    expect(state.messages).toHaveLength(0);
  });

  it('finishReason error 재시도를 다 쓰면 도구 호출 문제 안내를 돌려준다', () => {
    const state = makeState({ retryCount: MAX_RETRIES });

    const result = handleAbnormalFinish(response(null, 'error'), 'T', state);

    expect(result?.text).toBe('도구 호출에 문제가 생겼어. 다시 한번 말해줘.');
  });

  it('length 종료는 재시도 없이 받은 텍스트를 돌려주고, 없으면 안내 문구를 쓴다', () => {
    expect(handleAbnormalFinish(response('중간까지', 'length'), 'T', makeState())?.text).toBe(
      '중간까지',
    );
    expect(handleAbnormalFinish(response(null, 'length'), 'T', makeState())?.text).toBe(
      '처리 중 문제가 생겼어. 다시 말해줘.',
    );
  });
});
