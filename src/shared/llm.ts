import Groq from 'groq-sdk';
import type {
  ChatCompletion,
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionMessageToolCall,
} from 'groq-sdk/resources/chat/completions';
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

// ---- 팩토리 ----

export const createLLMClient = async (): Promise<LLMClient> => {
  const { CONFIG } = await import('./config.js');

  if (CONFIG.llm.provider === 'groq') {
    return new GroqLLMClient(CONFIG.llm.groqApiKey);
  }
  throw new Error(`지원하지 않는 LLM provider: ${CONFIG.llm.provider}`);
};

// ---- 변환 함수 (테스트 가능하도록 export) ----

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
