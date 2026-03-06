import type { AgentHandler } from '../../router.js';
import type { LLMClient, LLMMessage, LLMToolCall } from '../../shared/llm.js';
import { callMCPTool } from '../../shared/mcp-client.js';
import { sendMessage } from '../../shared/slack.js';
import { buildSystemPrompt, getTodayString } from './prompt.js';
import { getScheduleTools } from './tools.js';

const MAX_TOOL_ROUNDS = 10;
const MAX_RETRIES = 2;
const MAX_RATE_LIMIT_RETRIES = 3;

/** 에러 메시지에서 "Please retry in Xs" 파싱. 없으면 기본값 반환 */
const parseRetryDelay = (errorMsg: string, defaultMs: number): number => {
  const match = /retry in (\d+(?:\.\d+)?)\s*s/i.exec(errorMsg);
  if (match?.[1]) {
    return Math.ceil(Number(match[1]) * 1000);
  }
  return defaultMs;
};

const executeToolCalls = async (
  toolCalls: LLMToolCall[],
): Promise<LLMMessage[]> => {
  const results = await Promise.all(
    toolCalls.map(async (tc): Promise<LLMMessage> => {
      // eslint-disable-next-line no-console
      console.log(`[Schedule Agent] 도구 호출: ${tc.name}`, JSON.stringify(tc.arguments).slice(0, 200));
      try {
        const result = await callMCPTool(tc.name, tc.arguments);
        // eslint-disable-next-line no-console
        console.log(`[Schedule Agent] 도구 결과: ${tc.name}`, result.slice(0, 200));
        return { role: 'tool', content: result, toolCallId: tc.id };
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : '알 수 없는 오류';
        console.error(`[Schedule Agent] 도구 오류: ${tc.name}`, errorMessage);
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

const runAgentLoop = async (
  llmClient: LLMClient,
  userText: string,
  dbId: string,
): Promise<string> => {
  const today = getTodayString();
  const systemPrompt = buildSystemPrompt(dbId, today);
  const tools = await getScheduleTools();

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userText },
  ];

  let retryCount = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // eslint-disable-next-line no-console
    console.log(`[Schedule Agent] LLM 호출 (round ${round + 1})`);

    let response;
    try {
      response = await llmClient.chat(messages, tools);
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      console.error(`[Schedule Agent] LLM 호출 오류 (round ${round + 1}):`, errorMsg.slice(0, 500));
      try {
        const props = error !== null && typeof error === 'object' ? Object.getOwnPropertyNames(error) : [];
        const detail = JSON.stringify(error, props, 2);
        console.error(`[Schedule Agent] LLM 에러 상세:`, detail?.slice(0, 1000));
      } catch {
        // 직렬화 불가 시 무시
      }

      const isRateLimit = /\b(429|RESOURCE_EXHAUSTED|quota)\b/i.test(errorMsg);
      const isTransient = /\b(500|503|429|INTERNAL|UNAVAILABLE|DEADLINE_EXCEEDED|overloaded|high demand|fetch failed)\b/i.test(errorMsg);
      const maxRetries = isRateLimit ? MAX_RATE_LIMIT_RETRIES : MAX_RETRIES;

      if (isTransient && retryCount < maxRetries) {
        retryCount++;
        const delay = isRateLimit
          ? parseRetryDelay(errorMsg, 60_000)
          : retryCount * 3000;
        // eslint-disable-next-line no-console
        console.log(`[Schedule Agent] 일시적 API 오류 재시도 (${retryCount}/${maxRetries}, ${Math.round(delay / 1000)}s 대기)`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      if (isRateLimit) {
        return 'API 호출 한도를 초과했어. 잠시 후에 다시 말해줘.';
      }

      // 재시도 불가능한 에러 → throw 대신 사용자 친화적 메시지 반환
      return '일시적인 오류가 발생했어. 다시 한번 말해줘.';
    }

    // eslint-disable-next-line no-console
    console.log(`[Schedule Agent] finishReason: ${response.finishReason}, toolCalls: ${response.toolCalls.length}`);

    if (response.finishReason === 'stop') {
      return response.text ?? '처리했어.';
    }

    if (response.finishReason === 'tool_calls' && response.toolCalls.length > 0) {
      retryCount = 0;
      messages.push({
        role: 'assistant',
        content: response.text ?? '',
        toolCalls: response.toolCalls,
      });

      const toolResults = await executeToolCalls(response.toolCalls);
      messages.push(...toolResults);
      continue;
    }

    // MALFORMED_FUNCTION_CALL → 메시지 변경 없이 같은 호출 재시도
    if (response.finishReason === 'error' && retryCount < MAX_RETRIES) {
      retryCount++;
      // eslint-disable-next-line no-console
      console.log(`[Schedule Agent] MALFORMED_FUNCTION_CALL 재시도 (${retryCount}/${MAX_RETRIES})`);
      continue; // 메시지 추가 없이 동일 컨텍스트로 재시도
    }

    if (response.finishReason === 'error') {
      return '도구 호출에 문제가 생겼어. 다시 한번 말해줘.';
    }

    // length 등 예상치 못한 종료
    // eslint-disable-next-line no-console
    console.log(`[Schedule Agent] 예상치 못한 종료 — finishReason: ${response.finishReason}, text: ${response.text?.slice(0, 200) ?? 'null'}`);
    return response.text ?? '처리 중 문제가 생겼어. 다시 말해줘.';
  }

  return '요청이 너무 복잡해. 좀 더 간단하게 말해줘.';
};

const ACK_MESSAGES = [
  '잠깐만, 확인해볼게.',
  '잠시만, 보고 올게.',
  '알겠어, 잠깐만.',
  '오케이, 확인 중.',
  '잠깐, 찾아볼게.',
  '알겠어, 금방 할게.',
];

const getAckMessage = (): string =>
  ACK_MESSAGES[Math.floor(Math.random() * ACK_MESSAGES.length)];

export const createScheduleAgent = (
  llmClient: LLMClient,
  dbId: string,
): AgentHandler => {
  return async (message, say): Promise<void> => {
    try {
      if (!('text' in message) || !message.text) {
        return;
      }

      // eslint-disable-next-line no-console
      console.log(`[Schedule Agent] 메시지 수신: ${message.text}`);
      await sendMessage(say, getAckMessage());
      const reply = await runAgentLoop(llmClient, message.text, dbId);
      await sendMessage(say, reply);
    } catch (error: unknown) {
      // Gemini SDK 등은 에러 상세를 다른 속성에 담을 수 있으므로 전체 출력
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Schedule Agent] 처리 오류: ${errorMsg.slice(0, 500)}`);
      if (error instanceof Error && error.cause) {
        console.error(`[Schedule Agent] 원인:`, error.cause);
      }
      // 에러 전체 구조 출력 (SDK 특유의 에러 필드 확인용)
      try {
        const props = error !== null && typeof error === 'object' ? Object.getOwnPropertyNames(error) : [];
        const errorDetail = JSON.stringify(error, props, 2);
        console.error(`[Schedule Agent] 에러 상세:`, errorDetail?.slice(0, 1000));
      } catch {
        console.error(`[Schedule Agent] 에러 객체:`, error);
      }
      await sendMessage(say, '일시적인 오류가 발생했어. 다시 한번 말해줘.');
    }
  };
};
