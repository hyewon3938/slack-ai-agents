import {
  MAX_RATE_LIMIT_RETRIES,
  MAX_RETRIES,
  type AgentLoopResult,
  type LoopState,
} from './types.js';
import { parseRetryDelay } from './timing.js';

/** LLM 호출 예외 처리. 재시도할 때는 null, 종료할 때는 결과를 돌려준다. */
export const handleLlmError = async (
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
