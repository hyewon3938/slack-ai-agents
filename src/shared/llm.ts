import Groq from 'groq-sdk';
import type {
  ChatCompletion,
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionMessageToolCall,
} from 'groq-sdk/resources/chat/completions';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import type {
  Content as GeminiContent,
  Part as GeminiPart,
  GenerateContentResponse,
  Tool as GeminiTool,
} from '@google/genai';
import type {
  MessageParam,
  Tool,
  ContentBlockParam,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/messages';

// ---- 공통 인터페이스 (Provider 독립) ----

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: LLMToolCall[];
}

export interface LLMToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  /** Gemini 3+ 모델의 thought signature (에코백 필수) */
  thoughtSignature?: string;
}

export interface LLMResponse {
  text: string | null;
  toolCalls: LLMToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
}

export interface LLMClient {
  chat(
    messages: LLMMessage[],
    tools?: LLMToolDefinition[],
  ): Promise<LLMResponse>;
}

// ---- Groq 구현체 ----

export class GroqLLMClient implements LLMClient {
  private client: Groq;
  private model: string;

  constructor(apiKey: string, model = 'llama-3.3-70b-versatile') {
    this.client = new Groq({ apiKey });
    this.model = model;
  }

  async chat(
    messages: LLMMessage[],
    tools?: LLMToolDefinition[],
  ): Promise<LLMResponse> {
    const groqMessages = toGroqMessages(messages);
    const groqTools = tools?.length ? toGroqTools(tools) : undefined;

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: groqMessages,
      tools: groqTools,
      tool_choice: groqTools ? 'auto' : undefined,
    });

    return fromGroqResponse(response);
  }
}

// ---- Claude 구현체 ----

export class ClaudeLLMClient implements LLMClient {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model = 'claude-sonnet-4-20250514') {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async chat(
    messages: LLMMessage[],
    tools?: LLMToolDefinition[],
  ): Promise<LLMResponse> {
    const { system, anthropicMessages } = toClaudeMessages(messages);
    const anthropicTools = tools?.length ? toClaudeTools(tools) : undefined;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: system ?? undefined,
      messages: anthropicMessages,
      tools: anthropicTools,
    });

    return fromClaudeResponse(response);
  }
}

// ---- Gemini 구현체 ----

export class GeminiLLMClient implements LLMClient {
  private client: GoogleGenAI;
  private model: string;

  constructor(apiKey: string, model = 'gemini-2.5-flash') {
    this.client = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  async chat(
    messages: LLMMessage[],
    tools?: LLMToolDefinition[],
  ): Promise<LLMResponse> {
    const { system, geminiContents } = toGeminiContents(messages);
    const geminiTools = tools?.length ? toGeminiTools(tools) : undefined;

    const response = await this.client.models.generateContent({
      model: this.model,
      contents: geminiContents,
      config: {
        systemInstruction: system ?? undefined,
        tools: geminiTools,
      },
    });

    return fromGeminiResponse(response);
  }
}

// ---- 팩토리 ----

export const createLLMClient = async (): Promise<LLMClient> => {
  const { CONFIG } = await import('./config.js');
  const modelOverride = CONFIG.llm.model || undefined;

  if (CONFIG.llm.provider === 'groq') {
    return new GroqLLMClient(CONFIG.llm.groqApiKey, modelOverride);
  }
  if (CONFIG.llm.provider === 'anthropic') {
    return new ClaudeLLMClient(CONFIG.llm.anthropicApiKey, modelOverride);
  }
  if (CONFIG.llm.provider === 'gemini') {
    return new GeminiLLMClient(CONFIG.llm.geminiApiKey, modelOverride);
  }
  throw new Error(`지원하지 않는 LLM provider: ${CONFIG.llm.provider}`);
};

/**
 * 크론 전용 LLM 클라이언트 생성.
 * Sonnet 사용 — 맥락 이해 + 시제 정확도가 크론 메시지 품질에 중요.
 * Gemini Flash 복원 시: new GeminiLLMClient(CONFIG.llm.geminiApiKey, 'gemini-2.5-flash')
 */
export const createCronLLMClient = async (): Promise<LLMClient> => {
  const { CONFIG } = await import('./config.js');

  if (CONFIG.llm.anthropicApiKey) {
    // eslint-disable-next-line no-console
    console.log('[LLM] 크론용 Sonnet 클라이언트 생성');
    return new ClaudeLLMClient(CONFIG.llm.anthropicApiKey);
  }

  // Anthropic 키 없으면 메인 클라이언트로 폴백
  // eslint-disable-next-line no-console
  console.log('[LLM] ANTHROPIC_API_KEY 미설정 — 크론도 메인 LLM 사용');
  return createLLMClient();
};

// ---- Groq 변환 함수 (테스트 가능하도록 export) ----

export function toGroqMessages(
  messages: LLMMessage[],
): ChatCompletionMessageParam[] {
  return messages.map((msg): ChatCompletionMessageParam => {
    if (msg.role === 'tool') {
      if (!msg.toolCallId) {
        throw new Error('tool 메시지에는 toolCallId가 필요합니다');
      }
      return {
        role: 'tool',
        content: msg.content,
        tool_call_id: msg.toolCallId,
      };
    }

    if (msg.role === 'assistant' && msg.toolCalls?.length) {
      return {
        role: 'assistant',
        content: msg.content || null,
        tool_calls: msg.toolCalls.map(
          (tc): ChatCompletionMessageToolCall => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          }),
        ),
      };
    }

    return {
      role: msg.role,
      content: msg.content,
    };
  });
}

export function toGroqTools(
  tools: LLMToolDefinition[],
): ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

export function fromGroqResponse(response: ChatCompletion): LLMResponse {
  const choice = response.choices[0];
  if (!choice) {
    return { text: null, toolCalls: [], finishReason: 'error' };
  }

  const message = choice.message;

  const toolCalls: LLMToolCall[] = (message.tool_calls ?? []).map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
  }));

  let finishReason: LLMResponse['finishReason'];
  switch (choice.finish_reason) {
    case 'tool_calls':
      finishReason = 'tool_calls';
      break;
    case 'length':
      finishReason = 'length';
      break;
    default:
      finishReason = 'stop';
  }

  return {
    text: message.content,
    toolCalls,
    finishReason,
  };
}

// ---- Claude 변환 함수 (테스트 가능하도록 export) ----

export function toClaudeMessages(
  messages: LLMMessage[],
): { system: string | null; anthropicMessages: MessageParam[] } {
  let system: string | null = null;
  const anthropicMessages: MessageParam[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg) continue;

    if (msg.role === 'system') {
      system = msg.content;
      continue;
    }

    if (msg.role === 'user') {
      anthropicMessages.push({ role: 'user', content: msg.content });
      continue;
    }

    if (msg.role === 'assistant') {
      const content: ContentBlockParam[] = [];

      if (msg.content) {
        content.push({ type: 'text', text: msg.content });
      }

      if (msg.toolCalls?.length) {
        for (const tc of msg.toolCalls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          });
        }
      }

      anthropicMessages.push({
        role: 'assistant',
        content: content.length > 0 ? content : msg.content,
      });
      continue;
    }

    if (msg.role === 'tool') {
      // tool result → 연속된 tool 메시지를 하나의 user 메시지로 묶기
      const toolResults: ToolResultBlockParam[] = [];
      let j = i;
      while (j < messages.length && messages[j]?.role === 'tool') {
        const toolMsg = messages[j];
        if (!toolMsg) break;
        if (toolMsg.toolCallId) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolMsg.toolCallId,
            content: toolMsg.content,
          });
        }
        j++;
      }
      // i를 j-1로 이동 (for 루프에서 i++로 j가 됨)
      i = j - 1;

      anthropicMessages.push({ role: 'user', content: toolResults });
      continue;
    }
  }

  return { system, anthropicMessages };
}

export function toClaudeTools(tools: LLMToolDefinition[]): Tool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Tool['input_schema'],
  }));
}

export function fromClaudeResponse(
  response: Anthropic.Messages.Message,
): LLMResponse {
  let text: string | null = null;
  const toolCalls: LLMToolCall[] = [];

  for (const block of response.content) {
    if (block.type === 'text') {
      text = block.text;
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        name: block.name,
        arguments: block.input as Record<string, unknown>,
      });
    }
  }

  let finishReason: LLMResponse['finishReason'];
  switch (response.stop_reason) {
    case 'tool_use':
      finishReason = 'tool_calls';
      break;
    case 'max_tokens':
      finishReason = 'length';
      break;
    case 'end_turn':
      finishReason = 'stop';
      break;
    default:
      finishReason = 'stop';
  }

  return { text, toolCalls, finishReason };
}

// ---- Gemini 변환 함수 (테스트 가능하도록 export) ----

export function toGeminiContents(
  messages: LLMMessage[],
): { system: string | null; geminiContents: GeminiContent[] } {
  let system: string | null = null;
  const geminiContents: GeminiContent[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg) continue;

    if (msg.role === 'system') {
      system = msg.content;
      continue;
    }

    if (msg.role === 'user') {
      geminiContents.push({
        role: 'user',
        parts: [{ text: msg.content }],
      });
      continue;
    }

    if (msg.role === 'assistant') {
      const parts: GeminiPart[] = [];

      if (msg.content) {
        parts.push({ text: msg.content });
      }

      if (msg.toolCalls?.length) {
        for (const tc of msg.toolCalls) {
          const callPart: GeminiPart = {
            functionCall: {
              name: tc.name,
              args: tc.arguments,
            },
          };
          // Gemini 3+ 모델: thoughtSignature 에코백 (없으면 생략)
          if (tc.thoughtSignature) {
            (callPart as Record<string, unknown>)['thoughtSignature'] = tc.thoughtSignature;
          }
          parts.push(callPart);
        }
      }

      geminiContents.push({
        role: 'model',
        parts: parts.length > 0 ? parts : [{ text: '' }],
      });
      continue;
    }

    if (msg.role === 'tool') {
      // 연속된 tool 메시지를 하나의 user 메시지로 묶기
      const functionResponseParts: GeminiPart[] = [];
      let j = i;
      while (j < messages.length && messages[j]?.role === 'tool') {
        const toolMsg = messages[j];
        if (!toolMsg) break;

        // tool result content를 JSON으로 파싱 시도, 실패 시 문자열로 감싸기
        let responseData: Record<string, unknown>;
        try {
          responseData = JSON.parse(toolMsg.content) as Record<string, unknown>;
        } catch {
          responseData = { result: toolMsg.content };
        }

        // toolCallId에서 도구 이름 추출 (gemini-{index}-{name} 형식)
        const toolName = toolMsg.toolCallId?.replace(/^gemini-\d+-/, '') ?? 'unknown';

        functionResponseParts.push({
          functionResponse: {
            name: toolName,
            response: responseData,
          },
        });
        j++;
      }
      i = j - 1;

      geminiContents.push({
        role: 'user',
        parts: functionResponseParts,
      });
      continue;
    }
  }

  return { system, geminiContents };
}

// Gemini API가 지원하지 않는 JSON Schema 필드 제거 + $ref 인라인 치환
const UNSUPPORTED_SCHEMA_KEYS = new Set([
  '$defs', '$schema', 'additionalProperties', 'default', 'format',
  'oneOf', 'allOf', 'not', 'if', 'then', 'else',
  'patternProperties', 'minProperties', 'maxProperties',
  'contentMediaType', 'contentEncoding',
]);

export function sanitizeSchemaForGemini(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const defs = schema['$defs'] as Record<string, Record<string, unknown>> | undefined;
  const visited = new Set<string>();

  function resolve(obj: unknown): unknown {
    if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(resolve);

    const record = obj as Record<string, unknown>;

    // $ref → 정의 인라인
    if ('$ref' in record && typeof record['$ref'] === 'string') {
      const refName = (record['$ref'] as string).replace('#/$defs/', '');
      if (defs && refName in defs && !visited.has(refName)) {
        visited.add(refName);
        const resolved = resolve(defs[refName]);
        visited.delete(refName);
        return resolved;
      }
      return { type: 'object' };
    }

    // const → enum 변환 (Gemini는 const 미지원, enum은 지원)
    if ('const' in record) {
      const constVal = record['const'];
      return { type: typeof constVal === 'string' ? 'string' : 'string', enum: [String(constVal)] };
    }

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if (UNSUPPORTED_SCHEMA_KEYS.has(key)) continue;
      // required: [] (빈 배열)은 Gemini에서 MALFORMED_FUNCTION_CALL 유발 가능
      if (key === 'required' && Array.isArray(value) && value.length === 0) continue;
      result[key] = resolve(value);
    }
    return result;
  }

  return resolve(schema) as Record<string, unknown>;
}

export function toGeminiTools(tools: LLMToolDefinition[]): GeminiTool[] {
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: sanitizeSchemaForGemini(tool.inputSchema) as GeminiTool['functionDeclarations'] extends
          Array<infer D> ? D extends { parameters?: infer P } ? P : never : never,
      })),
    },
  ];
}

export function fromGeminiResponse(
  response: GenerateContentResponse,
): LLMResponse {
  const candidate = response.candidates?.[0];
  if (!candidate) {
    return { text: null, toolCalls: [], finishReason: 'error' };
  }

  let text: string | null = null;
  const toolCalls: LLMToolCall[] = [];

  const parts = candidate.content?.parts ?? [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;

    if (part.text !== undefined && part.text !== null) {
      // thinking part (thought: true)의 빈 텍스트는 무시
      if (part.text !== '' || !('thought' in part)) {
        text = text ? text + part.text : part.text;
      }
    }

    if (part.functionCall) {
      // Gemini 3+ 모델은 thoughtSignature를 functionCall part에 포함
      const sig = (part as Record<string, unknown>)['thoughtSignature'] as string | undefined;
      toolCalls.push({
        id: part.functionCall.id ?? `gemini-${i}-${part.functionCall.name ?? 'unknown'}`,
        name: part.functionCall.name ?? 'unknown',
        arguments: (part.functionCall.args ?? {}) as Record<string, unknown>,
        ...(sig ? { thoughtSignature: sig } : {}),
      });
    }
  }

  let finishReason: LLMResponse['finishReason'];
  if (toolCalls.length > 0) {
    finishReason = 'tool_calls';
  } else {
    switch (candidate.finishReason) {
      case 'MAX_TOKENS':
        finishReason = 'length';
        break;
      case 'MALFORMED_FUNCTION_CALL':
        // Gemini가 function call을 시도했으나 스키마 검증 실패
        console.warn('[Gemini] MALFORMED_FUNCTION_CALL — 스키마 불일치로 함수 호출 실패');
        finishReason = 'error';
        break;
      case 'STOP':
        finishReason = 'stop';
        break;
      default:
        finishReason = 'stop';
    }
  }

  return { text, toolCalls, finishReason };
}
