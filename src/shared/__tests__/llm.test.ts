import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import {
  toClaudeMessages,
  toClaudeTools,
  fromClaudeResponse,
  type LLMMessage,
  type LLMToolDefinition,
} from '../llm.js';

// Message mock 헬퍼: fromClaudeResponse는 content/stop_reason만 사용하지만
// Anthropic.Messages.Message 전체 타입을 만족시키기 위해 unknown 경유 캐스팅
const makeMessage = (
  content: Anthropic.Messages.Message['content'],
  stop_reason: Anthropic.Messages.Message['stop_reason'],
): Anthropic.Messages.Message =>
  ({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-6',
    stop_sequence: null,
    container: null,
    usage: {},
    content,
    stop_reason,
  }) as unknown as Anthropic.Messages.Message;

describe('toClaudeMessages', () => {
  it('system 메시지는 별도로 분리된다', () => {
    const messages: LLMMessage[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: '안녕' },
    ];
    const result = toClaudeMessages(messages);
    expect(result.system).toBe('You are helpful.');
    expect(result.anthropicMessages).toEqual([{ role: 'user', content: '안녕' }]);
  });

  it('user 메시지는 그대로 매핑된다', () => {
    const messages: LLMMessage[] = [{ role: 'user', content: '테스트' }];
    const result = toClaudeMessages(messages);
    expect(result.system).toBeNull();
    expect(result.anthropicMessages).toEqual([{ role: 'user', content: '테스트' }]);
  });

  it('assistant 텍스트 메시지는 text 블록 하나로 변환된다', () => {
    const messages: LLMMessage[] = [{ role: 'assistant', content: '답변' }];
    const result = toClaudeMessages(messages);
    expect(result.anthropicMessages).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: '답변' }] },
    ]);
  });

  it('assistant에 text + toolCalls가 있으면 text + tool_use 블록을 모두 포함한다', () => {
    const messages: LLMMessage[] = [
      {
        role: 'assistant',
        content: 'DB 조회할게',
        toolCalls: [{ id: 'tool_1', name: 'query_db', arguments: { sql: 'SELECT 1' } }],
      },
    ];
    const result = toClaudeMessages(messages);
    expect(result.anthropicMessages).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'DB 조회할게' },
          { type: 'tool_use', id: 'tool_1', name: 'query_db', input: { sql: 'SELECT 1' } },
        ],
      },
    ]);
  });

  it('assistant에 toolCalls만 있으면 tool_use 블록만 포함한다', () => {
    const messages: LLMMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tool_1', name: 'query_db', arguments: { sql: 'SELECT 1' } }],
      },
    ];
    const result = toClaudeMessages(messages);
    expect(result.anthropicMessages).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool_1', name: 'query_db', input: { sql: 'SELECT 1' } }],
      },
    ]);
  });

  it('단일 tool 메시지는 user role tool_result 블록으로 변환된다', () => {
    const messages: LLMMessage[] = [{ role: 'tool', content: '{"rows":[]}', toolCallId: 'tool_1' }];
    const result = toClaudeMessages(messages);
    expect(result.anthropicMessages).toEqual([
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool_1', content: '{"rows":[]}' }],
      },
    ]);
  });

  it('연속된 tool 메시지는 하나의 user 메시지로 묶인다', () => {
    const messages: LLMMessage[] = [
      { role: 'tool', content: 'result1', toolCallId: 'tool_1' },
      { role: 'tool', content: 'result2', toolCallId: 'tool_2' },
      { role: 'tool', content: 'result3', toolCallId: 'tool_3' },
    ];
    const result = toClaudeMessages(messages);
    expect(result.anthropicMessages).toHaveLength(1);
    expect(result.anthropicMessages[0]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'tool_1', content: 'result1' },
        { type: 'tool_result', tool_use_id: 'tool_2', content: 'result2' },
        { type: 'tool_result', tool_use_id: 'tool_3', content: 'result3' },
      ],
    });
  });

  it('빈 메시지 배열은 빈 결과를 반환한다', () => {
    const result = toClaudeMessages([]);
    expect(result.system).toBeNull();
    expect(result.anthropicMessages).toEqual([]);
  });
});

describe('toClaudeTools', () => {
  it('단일 도구의 필드를 매핑한다 (inputSchema → input_schema)', () => {
    const tools: LLMToolDefinition[] = [
      {
        name: 'query_db',
        description: 'DB 조회',
        inputSchema: { type: 'object', properties: { sql: { type: 'string' } } },
      },
    ];
    const result = toClaudeTools(tools);
    expect(result).toEqual([
      {
        name: 'query_db',
        description: 'DB 조회',
        input_schema: { type: 'object', properties: { sql: { type: 'string' } } },
      },
    ]);
  });

  it('여러 도구를 순서대로 매핑한다', () => {
    const tools: LLMToolDefinition[] = [
      { name: 'a', description: 'desc a', inputSchema: { type: 'object' } },
      { name: 'b', description: 'desc b', inputSchema: { type: 'object' } },
      { name: 'c', description: 'desc c', inputSchema: { type: 'object' } },
    ];
    const result = toClaudeTools(tools);
    expect(result).toHaveLength(3);
    expect(result.map((t) => t.name)).toEqual(['a', 'b', 'c']);
  });

  it('빈 배열은 빈 배열을 반환한다', () => {
    expect(toClaudeTools([])).toEqual([]);
  });
});

describe('fromClaudeResponse', () => {
  it('text 블록만 있는 응답은 text를 추출하고 toolCalls는 빈 배열이다', () => {
    const response = makeMessage(
      [{ type: 'text', text: '답변입니다', citations: null }],
      'end_turn',
    );
    const result = fromClaudeResponse(response);
    expect(result.text).toBe('답변입니다');
    expect(result.toolCalls).toEqual([]);
  });

  it('tool_use 블록만 있는 응답은 toolCalls를 추출하고 text는 null이다', () => {
    const response = makeMessage(
      [
        {
          type: 'tool_use',
          id: 'tool_1',
          name: 'query_db',
          input: { sql: 'SELECT 1' },
        } as unknown as Anthropic.Messages.ToolUseBlock,
      ],
      'tool_use',
    );
    const result = fromClaudeResponse(response);
    expect(result.text).toBeNull();
    expect(result.toolCalls).toEqual([
      { id: 'tool_1', name: 'query_db', arguments: { sql: 'SELECT 1' } },
    ]);
  });

  it('text + tool_use 혼합 응답은 둘 다 추출한다', () => {
    const response = makeMessage(
      [
        { type: 'text', text: '조회할게', citations: null },
        {
          type: 'tool_use',
          id: 'tool_1',
          name: 'query_db',
          input: { sql: 'SELECT 1' },
        } as unknown as Anthropic.Messages.ToolUseBlock,
      ],
      'tool_use',
    );
    const result = fromClaudeResponse(response);
    expect(result.text).toBe('조회할게');
    expect(result.toolCalls).toEqual([
      { id: 'tool_1', name: 'query_db', arguments: { sql: 'SELECT 1' } },
    ]);
  });

  it("stop_reason: 'end_turn' → finishReason: 'stop'", () => {
    const response = makeMessage([], 'end_turn');
    expect(fromClaudeResponse(response).finishReason).toBe('stop');
  });

  it("stop_reason: 'tool_use' → finishReason: 'tool_calls'", () => {
    const response = makeMessage([], 'tool_use');
    expect(fromClaudeResponse(response).finishReason).toBe('tool_calls');
  });

  it("stop_reason: 'max_tokens' → finishReason: 'length'", () => {
    const response = makeMessage([], 'max_tokens');
    expect(fromClaudeResponse(response).finishReason).toBe('length');
  });

  it("stop_reason: 'stop_sequence'는 default로 'stop'을 반환한다", () => {
    const response = makeMessage([], 'stop_sequence');
    expect(fromClaudeResponse(response).finishReason).toBe('stop');
  });

  it("stop_reason: null은 default로 'stop'을 반환한다", () => {
    const response = makeMessage([], null);
    expect(fromClaudeResponse(response).finishReason).toBe('stop');
  });
});
