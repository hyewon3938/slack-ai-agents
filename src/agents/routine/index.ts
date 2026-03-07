import type { AgentHandler } from '../../router.js';
import type { LLMClient } from '../../shared/llm.js';
import type { Client as NotionClient } from '@notionhq/client';
import { classifyMessage, respondCasualChat } from '../../shared/casual-chat.js';
import { runAgentLoop, getAckMessage } from '../../shared/agent-loop.js';
import { sendMessage } from '../../shared/slack.js';
import { getAgentRole, getAgentContext } from '../../shared/personality.js';
import { queryTodayRoutineRecords } from '../../shared/routine-notion.js';
import { buildRoutineBlocks } from './blocks.js';
import { buildRoutinePrompt, getTodayString } from './prompt.js';
import { getRoutineTools } from './tools.js';

const CASUAL_CHAT_MAX_LENGTH = 80;

/** 이 표현이 포함되면 키워드 무관하게 잡담으로 처리 */
const CASUAL_OVERRIDES = [
  '화이팅', '파이팅', '해볼게', '할게', '잘할게', '고마워', '수고',
  '잘 자', '알겠어', '그럴게', '응 알겠', 'ㅋㅋ', 'ㅎㅎ',
  '응원', '해봐야지', '해야지', '할 수 있겠지', '힘내', '힘들',
  '잘하고 있', '괜찮', '어떡해', '어떻게 하지',
];

const EXACT_KEYWORDS = new Set(['루틴', '루틴체크', '체크']);
const CRUD_KEYWORDS = ['추가', '삭제', '빼', '변경', '수정', '넣어', '만들어', '바꿔', '옮겨', '없애', '지워', '초기화', '시작'];
const ANALYTICS_KEYWORDS = ['얼마나', '통계', '달성', '지켰', '기록', '분석', '몇', '퍼센트', '잘하고'];
const DATE_KEYWORDS = ['내일', '모레', '어제', '그제', '이번주', '다음주', '저번주', '지난주'];
const ACTION_KEYWORDS = [...CRUD_KEYWORDS, ...ANALYTICS_KEYWORDS, '루틴', '보여', '알려', '조회', '목록'];

const AGENT_ROLE = getAgentRole('루틴');
const AGENT_CONTEXT = getAgentContext('루틴');

/** KST(UTC+9) 기준 오늘 날짜 (YYYY-MM-DD) */
const getTodayISO = (): string => {
  const now = new Date();
  const kst = new Date(now.getTime() + (now.getTimezoneOffset() + 540) * 60_000);
  const yyyy = kst.getFullYear();
  const mm = String(kst.getMonth() + 1).padStart(2, '0');
  const dd = String(kst.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

/** "루틴" 포함 조회 요청인지 판별 (CRUD/분석/날짜 키워드 없으면 오늘 체크리스트) */
const isChecklistRequest = (text: string): boolean => {
  const trimmed = text.trim();
  if (EXACT_KEYWORDS.has(trimmed)) return true;
  if (
    trimmed.includes('루틴') &&
    !CRUD_KEYWORDS.some((k) => trimmed.includes(k)) &&
    !ANALYTICS_KEYWORDS.some((k) => trimmed.includes(k)) &&
    !DATE_KEYWORDS.some((k) => trimmed.includes(k)) &&
    !CASUAL_OVERRIDES.some((p) => trimmed.includes(p))
  ) return true;
  return false;
};

/** 오늘 루틴 체크리스트를 조회하여 전송 */
const sendChecklist = async (
  notionClient: NotionClient,
  dbId: string,
  say: Parameters<AgentHandler>[1],
): Promise<void> => {
  const today = getTodayISO();
  const records = await queryTodayRoutineRecords(notionClient, dbId, today);

  if (records.length === 0) {
    await sendMessage(say, '오늘 루틴 기록이 없어. 아침 알림에서 자동으로 생성돼.');
    return;
  }

  const incomplete = records.filter((r) => !r.completed);
  if (incomplete.length === 0) {
    await sendMessage(say, '오늘 루틴 전부 완료했어!');
    return;
  }

  const { text: msgText, blocks } = buildRoutineBlocks(records, today);
  await say({ text: msgText, blocks });
};

export const createRoutineAgent = (
  llmClient: LLMClient,
  dbId: string,
  notionClient: NotionClient,
): AgentHandler => {
  return async (message, say): Promise<void> => {
    try {
      if (!('text' in message) || !message.text) {
        return;
      }

      const text = message.text.trim();

      // 1. 정확 매칭 빠른 경로: "루틴", "체크" → LLM 없이 즉시 체크리스트
      if (EXACT_KEYWORDS.has(text)) {
        await sendChecklist(notionClient, dbId, say);
        return;
      }

      // 2. 잡담 감지 (하이브리드: 키워드 → LLM 분류+응답)
      const result = await classifyMessage(
        llmClient, text, ACTION_KEYWORDS, CASUAL_CHAT_MAX_LENGTH,
        AGENT_CONTEXT, AGENT_ROLE, CASUAL_OVERRIDES,
      );
      if (result.intent === 'casual') {
        // eslint-disable-next-line no-console
        console.log(`[Routine Agent] 잡담 감지`);
        const reply = result.casualReply ?? await respondCasualChat(llmClient, text, AGENT_ROLE);
        await sendMessage(say, reply);
        return;
      }

      // 3. "루틴" 포함 조회 → 체크리스트 반환
      if (isChecklistRequest(text)) {
        await sendChecklist(notionClient, dbId, say);
        return;
      }

      // 4. LLM 에이전트 경로: 자연어 루틴 CRUD
      // eslint-disable-next-line no-console
      console.log(`[Routine Agent] 메시지 수신`);
      await sendMessage(say, getAckMessage());

      const reply = await runAgentLoop(llmClient, text, {
        label: 'Routine Agent',
        buildSystemPrompt: () => buildRoutinePrompt(dbId, getTodayString()),
        getTools: getRoutineTools,
      });
      await sendMessage(say, reply);
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Routine Agent] 처리 오류: ${errorMsg.slice(0, 500)}`);
      await sendMessage(say, '일시적인 오류가 발생했어. 다시 한번 말해줘.');
    }
  };
};
