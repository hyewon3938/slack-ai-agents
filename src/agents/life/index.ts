import type { AgentHandler } from '../../router.js';
import type { LLMClient } from '../../shared/llm.js';
import { runAgentLoop } from '../../shared/agent-loop.js';
import { sendBlockMessage, sendMessage } from '../../shared/slack.js';
import { SQL_TOOLS, executeSQLTool } from '../../shared/sql-tools.js';
import { ChatHistory } from '../../shared/chat-history.js';
import { queryTodaySchedules } from '../../shared/life-queries.js';
import { buildLifeSystemPrompt } from './prompt.js';
import { getTodayISO } from '../../shared/kst.js';
import { buildScheduleBlocks } from './blocks.js';

/** 일정 조회 패턴 (오늘 일정 fast path) */
const SCHEDULE_QUERY_RE = /^(오늘\s*)?일정(\s*(보여줘|보여|알려줘|뭐야|확인|뭐\s*있어))?[.?!]?$/;

/**
 * v2 통합 에이전트 생성.
 * 일정 + 루틴을 하나의 에이전트로 관리. SQL 도구만 사용.
 * 일정 조회 패턴은 fast path로 Block Kit 즉시 응답.
 */
export const createLifeAgent = (llmClient: LLMClient): AgentHandler => {
  const history = new ChatHistory();

  return async (message, say) => {
    const text = 'text' in message ? (message.text ?? '') : '';
    if (!text.trim()) return;

    const channelId = message.channel;
    const trimmed = text.trim();

    // ── fast path: 일정 조회 ──
    if (SCHEDULE_QUERY_RE.test(trimmed)) {
      try {
        const today = getTodayISO();
        const items = await queryTodaySchedules(today);
        if (items.length === 0) {
          await sendMessage(say, '오늘은 일정이 없어.');
          return;
        }
        // "일정" 단독 → full (overflow 포함), 그 외 → compact (버튼 없이)
        const compact = trimmed !== '일정';
        const { text: fallback, blocks } = buildScheduleBlocks(
          items, today, undefined, compact ? { compact: true } : undefined,
        );
        await sendBlockMessage(say, fallback, blocks);
      } catch (error: unknown) {
        console.error('[Life Agent] 일정 fast path 오류:', error);
        await sendMessage(say, '일정 조회 중 오류가 발생했어.');
      }
      return;
    }

    // ── LLM 에이전트 루프 ──
    try {
      const result = await runAgentLoop(
        llmClient,
        text,
        {
          label: 'Life Agent',
          buildSystemPrompt: () => buildLifeSystemPrompt(channelId),
          getTools: async () => SQL_TOOLS,
          executeToolCall: executeSQLTool,
          historyMessages: history.toMessages(channelId),
        },
      );

      await sendMessage(say, result.text);
      history.add(channelId, text, result.text);
    } catch (error: unknown) {
      console.error('[Life Agent] 오류:', error);
      await sendMessage(say, '오류가 발생했어. 다시 한번 말해줘.');
    }
  };
};
