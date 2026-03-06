import { describe, it, expect } from 'vitest';
import type { ChatCompletion } from 'groq-sdk/resources/chat/completions';
import type { GenerateContentResponse } from '@google/genai';
import {
  toGroqMessages,
  toGroqTools,
  fromGroqResponse,
  toGeminiContents,
  toGeminiTools,
  fromGeminiResponse,
  sanitizeSchemaForGemini,
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

// ---- Gemini 변환 함수 테스트 ----

describe('toGeminiContents', () => {
  it('system 메시지를 추출하고 user/assistant를 user/model로 변환한다', () => {
    const messages: LLMMessage[] = [
      { role: 'system', content: '시스템 프롬프트' },
      { role: 'user', content: '안녕' },
      { role: 'assistant', content: '반가워요' },
    ];

    const result = toGeminiContents(messages);

    expect(result.system).toBe('시스템 프롬프트');
    expect(result.geminiContents).toEqual([
      { role: 'user', parts: [{ text: '안녕' }] },
      { role: 'model', parts: [{ text: '반가워요' }] },
    ]);
  });

  it('assistant의 toolCalls를 functionCall parts로 변환한다', () => {
    const messages: LLMMessage[] = [
      {
        role: 'assistant',
        content: '검색할게요',
        toolCalls: [
          {
            id: 'gemini-0-notion_search',
            name: 'notion_search',
            arguments: { query: '일정' },
          },
        ],
      },
    ];

    const result = toGeminiContents(messages);

    expect(result.geminiContents).toEqual([
      {
        role: 'model',
        parts: [
          { text: '검색할게요' },
          { functionCall: { name: 'notion_search', args: { query: '일정' } } },
        ],
      },
    ]);
  });

  it('연속된 tool 메시지를 하나의 user 메시지로 묶는다', () => {
    const messages: LLMMessage[] = [
      {
        role: 'tool',
        content: '{"results": []}',
        toolCallId: 'gemini-0-search',
      },
      {
        role: 'tool',
        content: '{"ok": true}',
        toolCallId: 'gemini-1-update',
      },
    ];

    const result = toGeminiContents(messages);

    expect(result.geminiContents).toEqual([
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'search',
              response: { results: [] },
            },
          },
          {
            functionResponse: {
              name: 'update',
              response: { ok: true },
            },
          },
        ],
      },
    ]);
  });

  it('assistant의 toolCalls에 thoughtSignature가 있으면 functionCall part에 포함한다', () => {
    const messages: LLMMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'gemini-0-search',
            name: 'search',
            arguments: { query: '일정' },
            thoughtSignature: 'sig_abc123',
          },
        ],
      },
    ];

    const result = toGeminiContents(messages);
    const modelParts = result.geminiContents[0]?.parts ?? [];

    // functionCall part에 thoughtSignature가 포함되어야 함
    expect(modelParts[0]).toEqual({
      functionCall: { name: 'search', args: { query: '일정' } },
      thoughtSignature: 'sig_abc123',
    });
  });

  it('thoughtSignature가 없으면 functionCall part에 포함하지 않는다', () => {
    const messages: LLMMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'gemini-0-search',
            name: 'search',
            arguments: { query: '일정' },
          },
        ],
      },
    ];

    const result = toGeminiContents(messages);
    const modelParts = result.geminiContents[0]?.parts ?? [];

    expect(modelParts[0]).toEqual({
      functionCall: { name: 'search', args: { query: '일정' } },
    });
    expect((modelParts[0] as Record<string, unknown>)['thoughtSignature']).toBeUndefined();
  });

  it('JSON 파싱 실패 시 content를 result로 감싼다', () => {
    const messages: LLMMessage[] = [
      {
        role: 'tool',
        content: '일반 텍스트 결과',
        toolCallId: 'gemini-0-my_tool',
      },
    ];

    const result = toGeminiContents(messages);

    expect(result.geminiContents[0]?.parts?.[0]).toEqual({
      functionResponse: {
        name: 'my_tool',
        response: { result: '일반 텍스트 결과' },
      },
    });
  });
});

describe('toGeminiTools', () => {
  it('LLMToolDefinition을 Gemini functionDeclarations 형식으로 변환한다', () => {
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

    const result = toGeminiTools(tools);

    expect(result).toEqual([
      {
        functionDeclarations: [
          {
            name: 'create_page',
            description: '페이지 생성',
            parameters: {
              type: 'object',
              properties: { title: { type: 'string' } },
              required: ['title'],
            },
          },
        ],
      },
    ]);
  });
});

describe('fromGeminiResponse', () => {
  it('텍스트 응답을 올바르게 변환한다', () => {
    const response = {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ text: '안녕하세요!' }],
          },
          finishReason: 'STOP',
        },
      ],
    } as unknown as GenerateContentResponse;

    const result = fromGeminiResponse(response);

    expect(result).toEqual({
      text: '안녕하세요!',
      toolCalls: [],
      finishReason: 'stop',
    });
  });

  it('functionCall 응답을 tool_calls로 변환한다', () => {
    const response = {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [
              {
                functionCall: {
                  name: 'create_page',
                  args: { title: '새 일정' },
                },
              },
            ],
          },
          finishReason: 'STOP',
        },
      ],
    } as unknown as GenerateContentResponse;

    const result = fromGeminiResponse(response);

    expect(result.toolCalls).toEqual([
      {
        id: 'gemini-0-create_page',
        name: 'create_page',
        arguments: { title: '새 일정' },
      },
    ]);
    expect(result.finishReason).toBe('tool_calls');
  });

  it('candidates가 비어있으면 error finishReason을 반환한다', () => {
    const response = {
      candidates: [],
    } as unknown as GenerateContentResponse;

    const result = fromGeminiResponse(response);

    expect(result).toEqual({
      text: null,
      toolCalls: [],
      finishReason: 'error',
    });
  });

  it('finishReason이 MAX_TOKENS이면 length를 반환한다', () => {
    const response = {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ text: '잘린 텍스트...' }],
          },
          finishReason: 'MAX_TOKENS',
        },
      ],
    } as unknown as GenerateContentResponse;

    const result = fromGeminiResponse(response);

    expect(result.finishReason).toBe('length');
  });

  it('functionCall part에 thoughtSignature가 있으면 추출한다', () => {
    const response = {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [
              {
                functionCall: {
                  name: 'create_page',
                  args: { title: '새 일정' },
                },
                thoughtSignature: 'sig_xyz789',
              },
            ],
          },
          finishReason: 'STOP',
        },
      ],
    } as unknown as GenerateContentResponse;

    const result = fromGeminiResponse(response);

    expect(result.toolCalls[0]?.thoughtSignature).toBe('sig_xyz789');
  });

  it('thoughtSignature가 없으면 toolCall에 포함하지 않는다', () => {
    const response = {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [
              {
                functionCall: {
                  name: 'search',
                  args: {},
                },
              },
            ],
          },
          finishReason: 'STOP',
        },
      ],
    } as unknown as GenerateContentResponse;

    const result = fromGeminiResponse(response);

    expect(result.toolCalls[0]?.thoughtSignature).toBeUndefined();
  });

  it('functionCall에 id가 있으면 해당 id를 사용한다', () => {
    const response = {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [
              {
                functionCall: {
                  id: 'custom-id-123',
                  name: 'search',
                  args: {},
                },
              },
            ],
          },
          finishReason: 'STOP',
        },
      ],
    } as unknown as GenerateContentResponse;

    const result = fromGeminiResponse(response);

    expect(result.toolCalls[0]?.id).toBe('custom-id-123');
  });
});

describe('sanitizeSchemaForGemini', () => {
  it('$defs와 $ref를 인라인으로 치환한다', () => {
    const schema = {
      type: 'object',
      properties: {
        parent: { $ref: '#/$defs/ParentType' },
      },
      $defs: {
        ParentType: {
          type: 'object',
          properties: {
            database_id: { type: 'string' },
          },
        },
      },
    };

    const result = sanitizeSchemaForGemini(schema);

    expect(result).toEqual({
      type: 'object',
      properties: {
        parent: {
          type: 'object',
          properties: {
            database_id: { type: 'string' },
          },
        },
      },
    });
  });

  it('additionalProperties와 $schema를 제거한다', () => {
    const schema = {
      type: 'object',
      $schema: 'http://json-schema.org/draft-07/schema#',
      additionalProperties: false,
      properties: {
        name: { type: 'string' },
      },
    };

    const result = sanitizeSchemaForGemini(schema);

    expect(result).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
    });
  });

  it('순환 참조 시 빈 object로 대체한다', () => {
    const schema = {
      type: 'object',
      properties: {
        self: { $ref: '#/$defs/Node' },
      },
      $defs: {
        Node: {
          type: 'object',
          properties: {
            child: { $ref: '#/$defs/Node' },
          },
        },
      },
    };

    const result = sanitizeSchemaForGemini(schema);
    const props = result.properties as Record<string, Record<string, unknown>>;
    const selfNode = props.self;
    const childProps = selfNode.properties as Record<string, Record<string, unknown>>;

    // 순환 참조는 빈 object로 대체
    expect(childProps.child).toEqual({ type: 'object' });
  });

  it('default 필드를 제거한다', () => {
    const schema = {
      type: 'object',
      properties: {
        version: { type: 'string', default: '2022-06-28' },
      },
    };

    const result = sanitizeSchemaForGemini(schema);
    const props = result.properties as Record<string, Record<string, unknown>>;

    expect(props.version).toEqual({ type: 'string' });
  });
});
