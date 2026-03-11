import type { LLMClient, LLMMessage, LLMToolCall, LLMToolDefinition } from './llm.js';

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

// ---- 지연 ack ----

/** ack 전송 지연 시간 (ms). 이 시간 내에 LLM 응답이 오면 ack 생략 */
export const ACK_DELAY_MS = 1_500;

/**
 * 에이전트 루프를 실행하되, delayMs 이내에 완료되면 ack를 생략한다.
 * 잡담 등 빠른 응답에서 불필요한 "잠깐만" 메시지를 없앤다.
 */
export const runAgentLoopWithAck = async (
  llmClient: LLMClient,
  userText: string,
  config: AgentLoopConfig,
  sendAck: () => Promise<unknown>,
  delayMs = ACK_DELAY_MS,
): Promise<AgentLoopResult> => {
  const loopPromise = runAgentLoop(llmClient, userText, config);

  let ackPromise: Promise<unknown> | undefined;
  const timer = setTimeout(() => {
    ackPromise = sendAck();
  }, delayMs);

  const result = await loopPromise;
  clearTimeout(timer);

  // ack가 전송 중이면 완료 대기 (메시지 순서 보장)
  if (ackPromise) await ackPromise;

  return result;
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

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    ...(historyMessages ?? []).map((m) => ({ role: m.role as LLMMessage['role'], content: m.content })),
    { role: 'user', content: userText },
  ];

  const calledToolNames: string[] = [];
  const calledToolArgs: Record<string, unknown>[] = [];
  let retryCount = 0;
  let hallucinationRetried = false;

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

      // 크레딧 부족 (402 / billing / credit) — 재시도 불필요, 즉시 안내
      const isCreditError = /\b(402|credit_balance|insufficient.credit|billing|prepaid)\b/i.test(errorMsg);
      if (isCreditError) {
        return {
          text: 'API 크레딧이 부족해서 응답할 수 없어. 여기서 충전해줘: https://platform.claude.com/settings/billing',
          toolNames: calledToolNames,
          toolArgs: calledToolArgs,
        };
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
        return { text: 'API 호출 한도를 초과했어. 잠시 후에 다시 말해줘.', toolNames: calledToolNames, toolArgs: calledToolArgs };
      }

      return { text: '일시적인 오류가 발생했어. 다시 한번 말해줘.', toolNames: calledToolNames, toolArgs: calledToolArgs };
    }

    // eslint-disable-next-line no-console
    console.log(`[${label}] finishReason: ${response.finishReason}, toolCalls: ${response.toolCalls.length}`);

    if (response.finishReason === 'stop') {
      // 도구 미사용 환각 방지: 사용자가 데이터 변경/조회를 요청했는데 도구 호출 없이 응답하면 재시도
      if (!hallucinationRetried && calledToolNames.length === 0 && tools.length > 0) {
        const responseText = response.text ?? '';
        // 1) 사용자 메시지에 실제 액션 요청이 있는지 확인
        const userRequestsAction = /보여|알려|조회|추가|삭제|수정|변경|기록|등록|설정|확인해|찾아/.test(userText);
        // 2) 응답에 데이터 변경을 주장하는 동사가 있는지 확인
        const claimsAction = responseText
          ? /했어|넣었|추가했|완료했|수정했|삭제했|처리했|변경했|옮겼|바꿨|등록했|기록했/.test(responseText)
          : true;
        if (userRequestsAction && claimsAction) {
          hallucinationRetried = true;
          console.warn(`[${label}] 도구 미사용 환각 감지 — 재시도`);
          messages.push({ role: 'assistant', content: responseText || '(도구 호출 없이 응답)' });
          messages.push({
            role: 'user',
            content: '방금 도구를 호출하지 않고 작업을 완료했다고 했어. 실제로 반영하려면 반드시 도구를 호출해야 해. 다시 처리해줘.',
          });
          continue;
        }
      }
      return { text: response.text ?? '처리했어.', toolNames: calledToolNames, toolArgs: calledToolArgs };
    }

    if (response.finishReason === 'tool_calls' && response.toolCalls.length > 0) {
      retryCount = 0;
      calledToolNames.push(...response.toolCalls.map((tc) => tc.name));
      calledToolArgs.push(...response.toolCalls.map((tc) => tc.arguments));
      messages.push({
        role: 'assistant',
        content: response.text ?? '',
        toolCalls: response.toolCalls,
      });

      const toolResults = await executeToolCalls(response.toolCalls, label, executor);
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
      return { text: '도구 호출에 문제가 생겼어. 다시 한번 말해줘.', toolNames: calledToolNames, toolArgs: calledToolArgs };
    }

    // length 등 예상치 못한 종료
    // eslint-disable-next-line no-console
    console.log(`[${label}] 예상치 못한 종료 — finishReason: ${response.finishReason}, text: ${response.text?.slice(0, 200) ?? 'null'}`);
    return { text: response.text ?? '처리 중 문제가 생겼어. 다시 말해줘.', toolNames: calledToolNames, toolArgs: calledToolArgs };
  }

  return { text: '요청이 너무 복잡해. 좀 더 간단하게 말해줘.', toolNames: calledToolNames, toolArgs: calledToolArgs };
};
