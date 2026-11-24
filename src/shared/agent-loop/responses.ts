import type { LLMResponse, LLMToolDefinition } from '../llm.js';
import { MAX_RETRIES, type AgentLoopResult, type LoopState } from './types.js';

/** finishReason 'stop' 처리. 환각 재시도면 null, 아니면 최종 결과. */
export const handleStopResponse = (
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
/** stop·tool_calls가 아닌 응답 처리. MALFORMED 재시도면 null, 아니면 결과. */
export const handleAbnormalFinish = (
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
