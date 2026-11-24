import type { LLMClient, LLMMessage, LLMResponse, LLMToolCall, LLMToolDefinition } from './llm.js';

// ---- 상수 ----

export const MAX_TOOL_ROUNDS = 10;
export const MAX_RETRIES = 2;
export const MAX_RATE_LIMIT_RETRIES = 3;
export const LLM_TIMEOUT_MS = 60_000;
export const TOOL_TIMEOUT_MS = 30_000;

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

// ---- 에이전트 루프 ----

/** 에이전트 루프 결과 */
export interface AgentLoopResult {
  /** 최종 응답 텍스트 */
  text: string;
  /** 루프 중 호출된 도구 이름 목록 (중복 포함) */
  toolNames: string[];
  /** 루프 중 호출된 도구의 arguments 목록 (toolNames와 순서 대응) */
  toolArgs: Record<string, unknown>[];
  /** tool이 __earlyExit 마커를 반환했는지 — 호출자가 최종 메시지 전송을 스킵 */
  earlyExit?: boolean;
}

/** 도구 실행기 타입 */
export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<string>;

/** 에이전트 루프 설정 */
export interface AgentLoopConfig {
  /** 로그 라벨 (예: 'Schedule Agent') */
  label: string;
  /** 시스템 프롬프트 생성 함수 */
  buildSystemPrompt: () => string | Promise<string>;
  /** 도구 목록 제공 함수 */
  getTools: () => Promise<LLMToolDefinition[]>;
  /** 도구 실행기 */
  executeToolCall: ToolExecutor;
  /** 대화 히스토리 (user/assistant 메시지 배열) */
  historyMessages?: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
}

/** 도구 호출 실행 (병렬) */
export const executeToolCalls = async (
  toolCalls: LLMToolCall[],
  label: string,
  executor: ToolExecutor,
): Promise<LLMMessage[]> => {
  const results = await Promise.all(
    toolCalls.map(async (tc): Promise<LLMMessage> => {
      // eslint-disable-next-line no-console
      console.log(`[${label}] 도구 호출: ${tc.name}`, JSON.stringify(tc.arguments).slice(0, 200));
      try {
        const result = await withTimeout(
          executor(tc.name, tc.arguments),
          TOOL_TIMEOUT_MS,
          `도구 ${tc.name}`,
        );
        // eslint-disable-next-line no-console
        console.log(`[${label}] 도구 결과: ${tc.name}`, result.slice(0, 200));
        return { role: 'tool', content: result, toolCallId: tc.id };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류';
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

/** 루프가 라운드마다 갱신하는 상태 */
interface LoopState {
  messages: LLMMessage[];
  calledToolNames: string[];
  calledToolArgs: Record<string, unknown>[];
  retryCount: number;
  hallucinationRetried: boolean;
}

/** 시스템 프롬프트 + 히스토리 + 사용자 메시지로 초기 메시지 구성 */
const buildInitialMessages = (
  systemPrompt: string,
  historyMessages: AgentLoopConfig['historyMessages'],
  userText: string,
): LLMMessage[] => [
  { role: 'system', content: systemPrompt },
  ...(historyMessages ?? []).map((m) => ({
    role: m.role as LLMMessage['role'],
    content: m.content,
  })),
  { role: 'user', content: userText },
];

/** LLM 호출 예외 처리. 재시도할 때는 null, 종료할 때는 결과를 돌려준다. */
const handleLlmError = async (
  error: unknown,
  round: number,
  label: string,
  state: LoopState,
): Promise<AgentLoopResult | null> => {
  const errorMsg = error instanceof Error ? error.message : String(error);

  console.error(`[${label}] LLM 호출 오류 (round ${round + 1}):`, errorMsg.slice(0, 500));
  try {
    const props =
      error !== null && typeof error === 'object' ? Object.getOwnPropertyNames(error) : [];
    const detail = JSON.stringify(error, props, 2);
    console.error(`[${label}] LLM 에러 상세:`, detail?.slice(0, 1000));
  } catch {
    // 직렬화 불가 시 무시
  }

  // 크레딧 부족 (402 / billing / credit) — 재시도 불필요, 즉시 안내
  const isCreditError = /\b(402|credit_balance|insufficient.credit|billing|prepaid)\b/i.test(
    errorMsg,
  );
  if (isCreditError) {
    return {
      text: 'API 크레딧이 부족해서 응답할 수 없어. 여기서 충전해줘: https://platform.claude.com/settings/billing',
      toolNames: state.calledToolNames,
      toolArgs: state.calledToolArgs,
    };
  }

  const isRateLimit = /\b(429|RESOURCE_EXHAUSTED|quota)\b/i.test(errorMsg);
  const isTransient =
    /\b(500|503|429|INTERNAL|UNAVAILABLE|DEADLINE_EXCEEDED|overloaded|high demand|fetch failed|timeout)\b/i.test(
      errorMsg,
    );
  const maxRetries = isRateLimit ? MAX_RATE_LIMIT_RETRIES : MAX_RETRIES;

  if (isTransient && state.retryCount < maxRetries) {
    state.retryCount++;
    const delay = isRateLimit ? parseRetryDelay(errorMsg, 60_000) : state.retryCount * 3000;
    // eslint-disable-next-line no-console
    console.log(
      `[${label}] 일시적 API 오류 재시도 (${state.retryCount}/${maxRetries}, ${Math.round(delay / 1000)}s 대기)`,
    );
    await new Promise((r) => setTimeout(r, delay));
    return null;
  }

  if (isRateLimit) {
    return {
      text: 'API 호출 한도를 초과했어. 잠시 후에 다시 말해줘.',
      toolNames: state.calledToolNames,
      toolArgs: state.calledToolArgs,
    };
  }

  return {
    text: '일시적인 오류가 발생했어. 다시 한번 말해줘.',
    toolNames: state.calledToolNames,
    toolArgs: state.calledToolArgs,
  };
};

/** finishReason 'stop' 처리. 환각 재시도면 null, 아니면 최종 결과. */
const handleStopResponse = (
  response: LLMResponse,
  userText: string,
  tools: LLMToolDefinition[],
  label: string,
  state: LoopState,
): AgentLoopResult | null => {
  // 도구 미사용 환각 방지: 사용자가 데이터 변경/조회를 요청했는데 도구 호출 없이 응답하면 재시도
  if (!state.hallucinationRetried && state.calledToolNames.length === 0 && tools.length > 0) {
    const responseText = response.text ?? '';
    // 1) 사용자 메시지에 실제 액션 요청이 있는지 확인
    const userRequestsAction = /보여|알려|조회|추가|삭제|수정|변경|기록|등록|설정|확인해|찾아/.test(
      userText,
    );
    // 2) 응답에 데이터 변경을 주장하는 동사가 있는지 확인
    const claimsAction = responseText
      ? /했어|넣었|추가했|완료했|수정했|삭제했|처리했|변경했|옮겼|바꿨|등록했|기록했/.test(
          responseText,
        )
      : true;
    if (userRequestsAction && claimsAction) {
      state.hallucinationRetried = true;
      console.warn(`[${label}] 도구 미사용 환각 감지 — 재시도`);
      state.messages.push({ role: 'assistant', content: responseText || '(도구 호출 없이 응답)' });
      state.messages.push({
        role: 'user',
        content:
          '방금 도구를 호출하지 않고 작업을 완료했다고 했어. 실제로 반영하려면 반드시 도구를 호출해야 해. 다시 처리해줘.',
      });
      return null;
    }
  }
  return {
    text: response.text ?? '처리했어.',
    toolNames: state.calledToolNames,
    toolArgs: state.calledToolArgs,
  };
};

/** 도구 호출 응답 처리. earlyExit이면 결과, 아니면 null(다음 라운드). */
const handleToolCallsResponse = async (
  response: LLMResponse,
  label: string,
  executor: ToolExecutor,
  state: LoopState,
): Promise<AgentLoopResult | null> => {
  state.retryCount = 0;
  state.calledToolNames.push(...response.toolCalls.map((tc) => tc.name));
  state.calledToolArgs.push(...response.toolCalls.map((tc) => tc.arguments));
  state.messages.push({
    role: 'assistant',
    content: response.text ?? '',
    toolCalls: response.toolCalls,
  });

  const toolResults = await executeToolCalls(response.toolCalls, label, executor);
  state.messages.push(...toolResults);

  // __earlyExit 마커 감지 — LLM 재호출 없이 즉시 종료
  const earlyExitDetected = toolResults.some((tr) => {
    if (tr.role !== 'tool') return false;
    try {
      const parsed = JSON.parse(tr.content) as { __earlyExit?: boolean };
      return parsed.__earlyExit === true;
    } catch {
      return false;
    }
  });
  if (earlyExitDetected) {
    return {
      text: '',
      toolNames: state.calledToolNames,
      toolArgs: state.calledToolArgs,
      earlyExit: true,
    };
  }

  return null;
};

/** stop·tool_calls가 아닌 응답 처리. MALFORMED 재시도면 null, 아니면 결과. */
const handleAbnormalFinish = (
  response: LLMResponse,
  label: string,
  state: LoopState,
): AgentLoopResult | null => {
  // MALFORMED_FUNCTION_CALL → 메시지 변경 없이 같은 호출 재시도
  if (response.finishReason === 'error' && state.retryCount < MAX_RETRIES) {
    state.retryCount++;
    // eslint-disable-next-line no-console
    console.log(`[${label}] MALFORMED_FUNCTION_CALL 재시도 (${state.retryCount}/${MAX_RETRIES})`);
    return null;
  }

  if (response.finishReason === 'error') {
    return {
      text: '도구 호출에 문제가 생겼어. 다시 한번 말해줘.',
      toolNames: state.calledToolNames,
      toolArgs: state.calledToolArgs,
    };
  }

  // length 등 예상치 못한 종료
  // eslint-disable-next-line no-console
  console.log(
    `[${label}] 예상치 못한 종료 — finishReason: ${response.finishReason}, text: ${response.text?.slice(0, 200) ?? 'null'}`,
  );
  return {
    text: response.text ?? '처리 중 문제가 생겼어. 다시 말해줘.',
    toolNames: state.calledToolNames,
    toolArgs: state.calledToolArgs,
  };
};

/** LLM 에이전트 루프: LLM → 도구 호출 → LLM → … → 최종 응답. */
export const runAgentLoop = async (
  llmClient: LLMClient,
  userText: string,
  config: AgentLoopConfig,
): Promise<AgentLoopResult> => {
  const { label, buildSystemPrompt, getTools, executeToolCall, historyMessages } = config;
  const executor = executeToolCall;

  const systemPrompt = await buildSystemPrompt();
  const tools = await getTools();

  const state: LoopState = {
    messages: buildInitialMessages(systemPrompt, historyMessages, userText),
    calledToolNames: [],
    calledToolArgs: [],
    retryCount: 0,
    hallucinationRetried: false,
  };

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // eslint-disable-next-line no-console
    console.log(`[${label}] LLM 호출 (round ${round + 1})`);

    let response;
    try {
      response = await withTimeout(
        llmClient.chat(state.messages, tools),
        LLM_TIMEOUT_MS,
        'LLM 호출',
      );
    } catch (error: unknown) {
      const errorResult = await handleLlmError(error, round, label, state);
      if (errorResult) return errorResult;
      continue;
    }

    // eslint-disable-next-line no-console
    console.log(
      `[${label}] finishReason: ${response.finishReason}, toolCalls: ${response.toolCalls.length}`,
    );

    if (response.finishReason === 'stop') {
      const stopResult = handleStopResponse(response, userText, tools, label, state);
      if (stopResult) return stopResult;
      continue;
    }

    if (response.finishReason === 'tool_calls' && response.toolCalls.length > 0) {
      const toolResult = await handleToolCallsResponse(response, label, executor, state);
      if (toolResult) return toolResult;
      continue;
    }

    const abnormalResult = handleAbnormalFinish(response, label, state);
    if (abnormalResult) return abnormalResult;
  }

  return {
    text: '요청이 너무 복잡해. 좀 더 간단하게 말해줘.',
    toolNames: state.calledToolNames,
    toolArgs: state.calledToolArgs,
  };
};
