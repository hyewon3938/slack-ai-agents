import { describe, it, expect } from 'vitest';
import type { ChatCompletion } from 'groq-sdk/resources/chat/completions';
import {
  toGroqMessages,
  toGroqTools,
  fromGroqResponse,
} from '../llm.js';
import type { LLMMessage, LLMToolDefinition } from '../llm.js';

describe('toGroqMessages', () => {
  it('system/user/assistant 메시지를 올바르게 변환한다', () => {
    const messages: LLMMessage[] = [
      { role: 'system', content: '시스템 프롬프트' },
      { role: 'user', content: '안녕' },
      { role: 'assistant', content: '반가워요' },
    ];

    const result = toGroqMessages(messages);

    expect(result).toEqual([
      { role: 'system', content: '시스템 프롬프트' },
      { role: 'user', content: '안녕' },
      { role: 'assistant', content: '반가워요' },
    ]);
  });

  it('tool 메시지를 tool_call_id와 함께 변환한다', () => {
    const messages: LLMMessage[] = [
      { role: 'tool', content: '도구 결과', toolCallId: 'call_123' },
    ];

    const result = toGroqMessages(messages);

    expect(result).toEqual([
      { role: 'tool', content: '도구 결과', tool_call_id: 'call_123' },
    ]);
  });

  it('assistant 메시지의 toolCalls를 Groq 형식으로 변환한다', () => {
    const messages: LLMMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'call_456',
            name: 'create_page',
            arguments: { title: '테스트' },
          },
        ],
      },
    ];

    const result = toGroqMessages(messages);

    expect(result).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_456',
            type: 'function',
            function: {
              name: 'create_page',
              arguments: '{"title":"테스트"}',
            },
          },
        ],
      },
    ]);
  });
});

describe('toGroqTools', () => {
  it('LLMToolDefinition을 Groq ChatCompletionTool 형식으로 변환한다', () => {
    const tools: LLMToolDefinition[] = [
      {
        name: 'create_page',
        description: '페이지 생성',
        inputSchema: {
          type: 'object',
          properties: { title: { type: 'string' } },
          required: ['title'],
        },
      },
    ];

    const result = toGroqTools(tools);

    expect(result).toEqual([
      {
        type: 'function',
        function: {
          name: 'create_page',
          description: '페이지 생성',
          parameters: {
            type: 'object',
            properties: { title: { type: 'string' } },
            required: ['title'],
          },
        },
      },
    ]);
  });
});

describe('fromGroqResponse', () => {
  it('텍스트 응답을 올바르게 변환한다', () => {
    const response = {
      id: 'chatcmpl-123',
      object: 'chat.completion',
      created: 1234567890,
      model: 'llama-3.3-70b-versatile',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: '안녕하세요!' },
          finish_reason: 'stop',
          logprobs: null,
        },
      ],
    } as ChatCompletion;

    const result = fromGroqResponse(response);

    expect(result).toEqual({
      text: '안녕하세요!',
      toolCalls: [],
      finishReason: 'stop',
    });
  });

  it('tool_calls 응답을 파싱하여 변환한다', () => {
    const response = {
      id: 'chatcmpl-456',
      object: 'chat.completion',
      created: 1234567890,
      model: 'llama-3.3-70b-versatile',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_789',
                type: 'function',
                function: {
                  name: 'create_page',
                  arguments: '{"title":"이력서 수정"}',
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
          logprobs: null,
        },
      ],
    } as ChatCompletion;

    const result = fromGroqResponse(response);

    expect(result).toEqual({
      text: null,
      toolCalls: [
        {
          id: 'call_789',
          name: 'create_page',
          arguments: { title: '이력서 수정' },
        },
      ],
      finishReason: 'tool_calls',
    });
  });

  it('choices가 비어있으면 error finishReason을 반환한다', () => {
    const response = {
      id: 'chatcmpl-empty',
      object: 'chat.completion',
      created: 1234567890,
      model: 'llama-3.3-70b-versatile',
      choices: [],
    } as ChatCompletion;

    const result = fromGroqResponse(response);

    expect(result).toEqual({
      text: null,
      toolCalls: [],
      finishReason: 'error',
    });
  });

  it('finish_reason이 length이면 length를 반환한다', () => {
    const response = {
      id: 'chatcmpl-len',
      object: 'chat.completion',
      created: 1234567890,
      model: 'llama-3.3-70b-versatile',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: '잘린 텍스트...' },
          finish_reason: 'length',
          logprobs: null,
        },
      ],
    } as ChatCompletion;

    const result = fromGroqResponse(response);

    expect(result.finishReason).toBe('length');
  });
});
