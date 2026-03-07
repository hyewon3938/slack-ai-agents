import type { AgentHandler } from '../../router.js';
import type { LLMClient } from '../../shared/llm.js';
import { classifyMessage, respondCasualChat } from '../../shared/casual-chat.js';
import { runAgentLoop, getAckMessage } from '../../shared/agent-loop.js';
import { sendMessage } from '../../shared/slack.js';
import { getAgentRole, getAgentContext } from '../../shared/personality.js';
import { buildSystemPrompt, getTodayString } from './prompt.js';
import { getScheduleTools } from './tools.js';

const CASUAL_CHAT_MAX_LENGTH = 80;
const ACTION_KEYWORDS = [
  '추가', '삭제', '빼', '변경', '수정', '넣어', '만들어', '바꿔', '옮겨',
  '없애', '지워', '완료', '취소',
  '일정', '할일', '보여', '알려', '조회', '목록', '백로그',
  '오늘', '내일', '모레', '이번주', '다음주', '언제',
];

/** 이 표현이 포함되면 키워드 무관하게 잡담으로 처리 */
const CASUAL_OVERRIDES = [
  '화이팅', '파이팅', '해볼게', '할게', '잘할게', '고마워', '수고',
  '잘 자', '알겠어', '그럴게', '응 알겠', 'ㅋㅋ', 'ㅎㅎ',
  '응원', '해봐야지', '해야지', '할 수 있겠지', '힘내', '힘들',
  '잘하고 있', '괜찮', '어떡해', '어떻게 하지',
];

const AGENT_ROLE = getAgentRole('일정');
const AGENT_CONTEXT = getAgentContext('일정');

export const createScheduleAgent = (
  llmClient: LLMClient,
  dbId: string,
): AgentHandler => {
  return async (message, say): Promise<void> => {
    try {
      if (!('text' in message) || !message.text) {
        return;
      }

      const text = message.text.trim();

      // 잡담 감지 (하이브리드: 키워드 → LLM 분류+응답)
      const result = await classifyMessage(
        llmClient, text, ACTION_KEYWORDS, CASUAL_CHAT_MAX_LENGTH,
        AGENT_CONTEXT, AGENT_ROLE, CASUAL_OVERRIDES,
      );
      if (result.intent === 'casual') {
        // eslint-disable-next-line no-console
        console.log(`[Schedule Agent] 잡담 감지`);
        const reply = result.casualReply ?? await respondCasualChat(llmClient, text, AGENT_ROLE);
        await sendMessage(say, reply);
        return;
      }

      // LLM 에이전트 경로: 자연어 일정 CRUD
      // eslint-disable-next-line no-console
      console.log(`[Schedule Agent] 메시지 수신: ${text}`);
      await sendMessage(say, getAckMessage());

      const reply = await runAgentLoop(llmClient, text, {
        label: 'Schedule Agent',
        buildSystemPrompt: () => buildSystemPrompt(dbId, getTodayString()),
        getTools: getScheduleTools,
      });
      await sendMessage(say, reply);
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Schedule Agent] 처리 오류: ${errorMsg.slice(0, 500)}`);
      if (error instanceof Error && error.cause) {
        console.error(`[Schedule Agent] 원인:`, error.cause);
      }
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
