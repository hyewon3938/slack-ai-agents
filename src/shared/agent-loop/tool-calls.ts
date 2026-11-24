import type { LLMMessage, LLMResponse, LLMToolCall } from '../llm.js';
import {
  TOOL_TIMEOUT_MS,
  type AgentLoopResult,
  type LoopState,
  type ToolExecutor,
} from './types.js';
import { TimeoutError, withTimeout } from './timing.js';

/**
 * 타임아웃 결과 안내. 타임아웃은 기다림만 멈추고 실행을 취소하지 않으므로
 * 쓰기가 뒤늦게 반영됐을 수 있다 — LLM이 같은 쓰기를 바로 다시 시도하지 않게 확인을 먼저 요구한다.
 */
const TIMEOUT_GUIDANCE =
  '실행이 끝났는지 알 수 없어. 데이터를 바꾸는 도구였다면 다시 실행하기 전에 조회로 반영됐는지 먼저 확인해.';

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
        const content =
          error instanceof TimeoutError
            ? `도구 실행 오류: ${errorMessage}. ${TIMEOUT_GUIDANCE}`
            : `도구 실행 오류: ${errorMessage}`;
        return { role: 'tool', content, toolCallId: tc.id };
      }
    }),
  );

  return results;
};
/** 도구 호출 응답 처리. earlyExit이면 결과, 아니면 null(다음 라운드). */
export const handleToolCallsResponse = async (
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
