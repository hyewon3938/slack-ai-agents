import type { AgentHandler } from '../../router.js';
import type { LLMClient } from '../../shared/llm.js';
import { runAgentLoop } from '../../shared/agent-loop.js';
import { sendMessage } from '../../shared/slack.js';
import { SQL_TOOLS, executeSQLTool } from '../../shared/sql-tools.js';
import { ChatHistory } from '../../shared/chat-history.js';
import { buildMoneySystemPrompt } from './prompt.js';

/**
 * 지출/예산 관리 에이전트.
 * #money 채널에서 자연어로 지출 기록, 예산 조회, 런웨이 분석 처리.
 */
export const createMoneyAgent = (llmClient: LLMClient): AgentHandler => {
  const history = new ChatHistory();

  return async (message, say) => {
    const text = 'text' in message ? (message.text ?? '') : '';
    if (!text.trim()) return;

    const channelId = message.channel;

    try {
      const result = await runAgentLoop(llmClient, text, {
        label: 'Money Agent',
        buildSystemPrompt: () => buildMoneySystemPrompt(),
        getTools: async () => SQL_TOOLS,
        executeToolCall: executeSQLTool,
        historyMessages: history.toMessages(channelId),
      });

      await sendMessage(say, result.text);
      history.add(channelId, text, result.text);
    } catch (error: unknown) {
      console.error('[Money Agent] 오류:', error);
      await sendMessage(say, '지출 처리 중 오류가 발생했어.');
    }
  };
};
