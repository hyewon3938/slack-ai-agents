import type { LLMClient, LLMMessage, LLMToolCall, LLMToolDefinition } from './llm.js';
import { callMCPTool } from './mcp-client.js';

// ---- 상수 ----

export const MAX_TOOL_ROUNDS = 10;
export const MAX_RETRIES = 2;
export const MAX_RATE_LIMIT_RETRIES = 3;
export const LLM_TIMEOUT_MS = 60_000;
export const TOOL_TIMEOUT_MS = 30_000;

const ACK_MESSAGES = [
  '잠깐만, 확인해볼게.',
  '잠시만, 보고 올게.',
  '알겠어, 잠깐만.',
  '오케이, 확인 중.',
  '잠깐, 찾아볼게.',
  '알겠어, 금방 할게.',
] as const;

// ---- 유틸리티 ----

/** Promise에 타임아웃을 적용하는 유틸리티 */
export const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout (${ms / 1000}s)`)), ms),
    ),
  ]);
};

/** 에러 메시지에서 "Please retry in Xs" 파싱. 없으면 기본값 반환 */
export const parseRetryDelay = (errorMsg: string, defaultMs: number): number => {
  const match = /retry in (\d+(?:\.\d+)?)\s*s/i.exec(errorMsg);
  if (match?.[1]) {
    return Math.ceil(Number(match[1]) * 1000);
  }
  return defaultMs;
};

/** 랜덤 ACK 메시지 반환 */
export const getAckMessage = (): string =>
  ACK_MESSAGES[Math.floor(Math.random() * ACK_MESSAGES.length)];

// ---- 에이전트 루프 ----

/** 에이전트 루프 결과 */
export interface AgentLoopResult {
  /** 최종 응답 텍스트 */
  text: string;
  /** 루프 중 호출된 MCP 도구 이름 목록 (중복 포함) */
  toolNames: string[];
}

/** 에이전트 루프 설정 */
export interface AgentLoopConfig {
  /** 로그 라벨 (예: 'Schedule Agent') */
  label: string;
  /** 시스템 프롬프트 생성 함수 */
  buildSystemPrompt: () => string;
  /** MCP 도구 목록 제공 함수 */
  getTools: () => Promise<LLMToolDefinition[]>;
}

/** MCP 도구 호출 실행 (병렬) */
export const executeToolCalls = async (
  toolCalls: LLMToolCall[],
  label: string,
): Promise<LLMMessage[]> => {
  const results = await Promise.all(
    toolCalls.map(async (tc): Promise<LLMMessage> => {
      // eslint-disable-next-line no-console
      console.log(`[${label}] 도구 호출: ${tc.name}`, JSON.stringify(tc.arguments).slice(0, 200));
      try {
        const result = await withTimeout(
          callMCPTool(tc.name, tc.arguments),
          TOOL_TIMEOUT_MS,
          `도구 ${tc.name}`,
        );
        // eslint-disable-next-line no-console
        console.log(`[${label}] 도구 결과: ${tc.name}`, result.slice(0, 200));
        return { role: 'tool', content: result, toolCallId: tc.id };
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : '알 수 없는 오류';
        console.error(`[${label}] 도구 오류: ${tc.name}`, errorMessage);
        return {
          role: 'tool',
          content: `도구 실행 오류: ${errorMessage}`,
          toolCallId: tc.id,
        };
      }
    }),
  );

  return results;
};

/**
 * LLM 에이전트 루프: LLM → 도구 호출 → LLM → … → 최종 응답.
 * 양쪽 에이전트(schedule, routine)에서 공통으로 사용.
 */
export const runAgentLoop = async (
  llmClient: LLMClient,
  userText: string,
  config: AgentLoopConfig,
): Promise<AgentLoopResult> => {
  const { label, buildSystemPrompt, getTools } = config;

  const systemPrompt = buildSystemPrompt();
  const tools = await getTools();

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userText },
  ];

  const calledToolNames: string[] = [];
  let retryCount = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // eslint-disable-next-line no-console
    console.log(`[${label}] LLM 호출 (round ${round + 1})`);

    let response;
    try {
      response = await withTimeout(
        llmClient.chat(messages, tools),
        LLM_TIMEOUT_MS,
        'LLM 호출',
      );
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      console.error(`[${label}] LLM 호출 오류 (round ${round + 1}):`, errorMsg.slice(0, 500));
      try {
        const props = error !== null && typeof error === 'object' ? Object.getOwnPropertyNames(error) : [];
        const detail = JSON.stringify(error, props, 2);
        console.error(`[${label}] LLM 에러 상세:`, detail?.slice(0, 1000));
      } catch {
        // 직렬화 불가 시 무시
      }

      const isRateLimit = /\b(429|RESOURCE_EXHAUSTED|quota)\b/i.test(errorMsg);
      const isTransient = /\b(500|503|429|INTERNAL|UNAVAILABLE|DEADLINE_EXCEEDED|overloaded|high demand|fetch failed|timeout)\b/i.test(errorMsg);
      const maxRetries = isRateLimit ? MAX_RATE_LIMIT_RETRIES : MAX_RETRIES;

      if (isTransient && retryCount < maxRetries) {
        retryCount++;
        const delay = isRateLimit
          ? parseRetryDelay(errorMsg, 60_000)
          : retryCount * 3000;
        // eslint-disable-next-line no-console
        console.log(`[${label}] 일시적 API 오류 재시도 (${retryCount}/${maxRetries}, ${Math.round(delay / 1000)}s 대기)`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      if (isRateLimit) {
        return { text: 'API 호출 한도를 초과했어. 잠시 후에 다시 말해줘.', toolNames: calledToolNames };
      }

      return { text: '일시적인 오류가 발생했어. 다시 한번 말해줘.', toolNames: calledToolNames };
    }

    // eslint-disable-next-line no-console
    console.log(`[${label}] finishReason: ${response.finishReason}, toolCalls: ${response.toolCalls.length}`);

    if (response.finishReason === 'stop') {
      return { text: response.text ?? '처리했어.', toolNames: calledToolNames };
    }

    if (response.finishReason === 'tool_calls' && response.toolCalls.length > 0) {
      retryCount = 0;
      calledToolNames.push(...response.toolCalls.map((tc) => tc.name));
      messages.push({
        role: 'assistant',
        content: response.text ?? '',
        toolCalls: response.toolCalls,
      });

      const toolResults = await executeToolCalls(response.toolCalls, label);
      messages.push(...toolResults);
      continue;
    }

    // MALFORMED_FUNCTION_CALL → 메시지 변경 없이 같은 호출 재시도
    if (response.finishReason === 'error' && retryCount < MAX_RETRIES) {
      retryCount++;
      // eslint-disable-next-line no-console
      console.log(`[${label}] MALFORMED_FUNCTION_CALL 재시도 (${retryCount}/${MAX_RETRIES})`);
      continue;
    }

    if (response.finishReason === 'error') {
      return { text: '도구 호출에 문제가 생겼어. 다시 한번 말해줘.', toolNames: calledToolNames };
    }

    // length 등 예상치 못한 종료
    // eslint-disable-next-line no-console
    console.log(`[${label}] 예상치 못한 종료 — finishReason: ${response.finishReason}, text: ${response.text?.slice(0, 200) ?? 'null'}`);
    return { text: response.text ?? '처리 중 문제가 생겼어. 다시 말해줘.', toolNames: calledToolNames };
  }

  return { text: '요청이 너무 복잡해. 좀 더 간단하게 말해줘.', toolNames: calledToolNames };
};
