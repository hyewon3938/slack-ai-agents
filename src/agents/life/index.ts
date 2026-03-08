import type { AgentHandler } from '../../router.js';
import type { LLMClient } from '../../shared/llm.js';
import { runAgentLoopWithAck, getAckMessage } from '../../shared/agent-loop.js';
import { sendMessage } from '../../shared/slack.js';
import { SQL_TOOLS, executeSQLTool } from '../../shared/sql-tools.js';
import { ChatHistory } from '../../shared/chat-history.js';
import { buildLifeSystemPrompt } from './prompt.js';

/**
 * v2 통합 에이전트 생성.
 * 일정 + 루틴을 하나의 에이전트로 관리. SQL 도구만 사용.
 * Fast path 없음 — 모든 판단을 LLM에 위임.
 */
export const createLifeAgent = (llmClient: LLMClient): AgentHandler => {
  const history = new ChatHistory();

  return async (message, say) => {
    const text = 'text' in message ? (message.text ?? '') : '';
    if (!text.trim()) return;

    const channelId = message.channel;

    try {
      const result = await runAgentLoopWithAck(
        llmClient,
        text,
        {
          label: 'Life Agent',
          buildSystemPrompt: () => buildLifeSystemPrompt(history, channelId),
          getTools: async () => SQL_TOOLS,
          executeToolCall: executeSQLTool,
        },
        async () => sendMessage(say, getAckMessage()),
      );

      await sendMessage(say, result.text);
      history.add(channelId, text, result.text);
    } catch (error: unknown) {
      console.error('[Life Agent] 오류:', error);
      await sendMessage(say, '오류가 발생했어. 다시 한번 말해줘.');
    }
  };
};
