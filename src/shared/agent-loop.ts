import type { LLMClient, LLMMessage } from './llm.js';
import {
  LLM_TIMEOUT_MS,
  MAX_TOOL_ROUNDS,
  type AgentLoopConfig,
  type AgentLoopResult,
  type LoopState,
} from './agent-loop/types.js';
import { withTimeout } from './agent-loop/timing.js';
import { handleLlmError } from './agent-loop/llm-error.js';
import { handleStopResponse, handleAbnormalFinish } from './agent-loop/responses.js';
import { handleToolCallsResponse } from './agent-loop/tool-calls.js';

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
