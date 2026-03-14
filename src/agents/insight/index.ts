import type { AgentHandler } from '../../router.js';
import type { LLMClient } from '../../shared/llm.js';
import { runAgentLoop } from '../../shared/agent-loop.js';
import { sendMessage } from '../../shared/slack.js';
import { SQL_TOOLS, executeSQLTool } from '../../shared/sql-tools.js';
import { ChatHistory } from '../../shared/chat-history.js';
import { buildInsightSystemPrompt } from './prompt.js';

/**
 * Insight 에이전트 생성.
 * 명리학 일운 분석 조회 + 일기/고민 자동 기록 + 삶의 테마 관리.
 * 모든 메시지를 LLM에게 전달 (fast path 없음 — 일기 자동 저장을 위해).
 */
export const createInsightAgent = (llmClient: LLMClient): AgentHandler => {
  const history = new ChatHistory();

  return async (message, say) => {
    const text = 'text' in message ? (message.text ?? '') : '';
    if (!text.trim()) return;

    const channelId = message.channel;

    try {
      const result = await runAgentLoop(
        llmClient,
        text,
        {
          label: 'Insight Agent',
          buildSystemPrompt: () => buildInsightSystemPrompt(),
          getTools: async () => SQL_TOOLS,
          executeToolCall: executeSQLTool,
          historyMessages: history.toMessages(channelId),
        },
      );

      await sendMessage(say, result.text);
      history.add(channelId, text, result.text);
    } catch (error: unknown) {
      console.error('[Insight Agent] 오류:', error);
      await sendMessage(say, '오류가 발생했어. 다시 한번 말해줘.');
    }
  };
};
