import Groq from 'groq-sdk';
import type {
  ChatCompletion,
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionMessageToolCall,
} from 'groq-sdk/resources/chat/completions';
import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageParam,
  Tool,
  ContentBlockParam,
  ToolResultBlockParam,
  TextBlockParam,
} from '@anthropic-ai/sdk/resources/messages';

/** 마지막 도구에 cache_control 추가 (도구 정의 캐싱) */
const withToolCacheControl = (tools: Tool[]): Tool[] => {
  if (tools.length === 0) return tools;
  return tools.map((tool, i) =>
    i === tools.length - 1
      ? { ...tool, cache_control: { type: 'ephemeral' } }
      : tool,
  );
};

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

  constructor(apiKey: string, model = 'claude-sonnet-4-6') {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async chat(
    messages: LLMMessage[],
    tools?: LLMToolDefinition[],
  ): Promise<LLMResponse> {
    const { system, anthropicMessages } = toClaudeMessages(messages);
    const anthropicTools = tools?.length ? toClaudeTools(tools) : undefined;

    // 프롬프트 캐싱: system 프롬프트와 마지막 도구 정의에 cache_control 추가.
    // 캐시 TTL 5분, 캐시 히트 시 토큰 비용 90% 절감.
    const systemBlocks: TextBlockParam[] | undefined = system
      ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
      : undefined;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: systemBlocks,
      messages: anthropicMessages,
      tools: anthropicTools ? withToolCacheControl(anthropicTools) : undefined,
    });

    return fromClaudeResponse(response);
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
  throw new Error(`지원하지 않는 LLM provider: ${CONFIG.llm.provider}`);
};

/**
 * 크론 전용 LLM 클라이언트 생성.
 * Sonnet 사용 — 맥락 이해 + 시제 정확도가 크론 메시지 품질에 중요.
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
