import type { AgentHandler } from '../../router.js';
import type { LLMClient } from '../../shared/llm.js';
import type { NotionClient } from '../../shared/notion.js';
import { classifyMessage, respondCasualChat } from '../../shared/casual-chat.js';
import { runAgentLoop, getAckMessage } from '../../shared/agent-loop.js';
import type { AgentLoopResult } from '../../shared/agent-loop.js';
import { sendMessage, sendBlockMessage } from '../../shared/slack.js';
import { getAgentRole, getAgentContext } from '../../shared/personality.js';
import { queryTodaySchedules, queryBacklogItems } from '../../shared/notion.js';
import { buildReminderMessage, formatDateShort, formatScheduleList } from '../../cron/schedule-reminder.js';
import { buildSystemPrompt, getTodayString } from './prompt.js';
import { getScheduleTools } from './tools.js';
import { buildScheduleBlocks } from './blocks.js';

const CASUAL_CHAT_MAX_LENGTH = 80;
const ACTION_KEYWORDS = [
  '추가', '삭제', '빼', '변경', '수정', '넣어', '만들어', '바꿔', '옮겨',
  '없애', '지워', '완료', '취소',
  '진행중', '진행', '시작', '끝났', '끝냈', '끝내', '마쳤', '했어', '했다', '안했', '못했', '미뤄', '연기',
  '일정', '할일', '보여', '알려', '조회', '목록', '백로그',
  '오늘', '내일', '모레', '이번주', '다음주', '언제',
];

/** 이 표현이 포함되면 키워드 무관하게 잡담으로 처리 */
const CASUAL_OVERRIDES = [
  '화이팅', '파이팅', '해볼게', '할게', '잘할게', '고마워', '수고',
  '잘 자', '알겠어', '그럴게', '응 알겠', 'ㅋㅋ', 'ㅎㅎ',
  '응원', '해봐야지', '해야지', '할 수 있겠지', '힘내', '힘들', '힘드', '힘든',
  '잘하고 있', '괜찮', '어떡해', '어떻게 하지', '피곤', '귀찮', '지쳤', '싫어',
];

const AGENT_ROLE = getAgentRole('일정');
const AGENT_CONTEXT = getAgentContext('일정');

// --- 변경 후 일정 표시 ---

/** 데이터 변경을 수행하는 MCP 도구 이름 */
const MUTATION_TOOLS = new Set(['API-post-page', 'API-patch-page', 'API-patch-block-children']);

/** 에이전트 루프에서 변경 작업이 수행되었는지 확인 */
const hasMutation = (result: AgentLoopResult): boolean =>
  result.toolNames.some((name) => MUTATION_TOOLS.has(name));

/** 사용자 텍스트에서 대상 날짜 추출 (오늘/내일/모레 → YYYY-MM-DD, 판별 불가 시 null) */
export const extractMutationDate = (text: string, todayISO: string): string | null => {
  if (text.includes('모레')) return addDays(todayISO, 2);
  if (text.includes('내일')) return addDays(todayISO, 1);
  // "오늘" 명시 또는 날짜 키워드 없음 → 오늘 (대부분의 변경은 오늘 대상)
  if (text.includes('오늘')) return todayISO;
  // 복잡한 날짜 (이번주, 다음주, N월 N일 등) → 건너뜀
  const hasComplexDate = ['이번주', '다음주', '저번주', '지난주', '월요', '화요', '수요', '목요', '금요', '토요', '일요', '월 ', '일에'].some((k) => text.includes(k));
  if (hasComplexDate) return null;
  // 날짜 키워드 없음 → 기본 오늘
  return todayISO;
};

// --- 조회 빠른 경로 ---

/** 쓰기 키워드 — 하나라도 있으면 조회 빠른 경로 불가 */
const WRITE_KEYWORDS = [
  '추가', '삭제', '빼', '변경', '수정', '넣어', '만들어', '바꿔', '옮겨',
  '없애', '지워', '완료', '취소',
];

/** 복잡한 조회 → 에이전트 루프 */
const COMPLEX_QUERY_KEYWORDS = ['이번주', '다음주', '언제', '지난주', '저번주'];

/** 조회 빠른 경로 최대 길이 (간단 조회는 보통 ~15자 이내) */
const QUERY_MAX_LENGTH = 20;

type QueryTarget = 'today' | 'tomorrow' | 'dayAfter';

/** 간단 조회 패턴 감지 → 대상 날짜 반환 (null이면 에이전트 루프) */
export const detectSimpleQuery = (text: string): QueryTarget | null => {
  if (text.length > QUERY_MAX_LENGTH) return null;
  if (WRITE_KEYWORDS.some((k) => text.includes(k))) return null;
  if (COMPLEX_QUERY_KEYWORDS.some((k) => text.includes(k))) return null;

  // 조회 의도 확인: (날짜 + 일정/조회 의도) 또는 (일정 + 조회 의도) 조합
  const hasScheduleWord = ['일정', '할일'].some((k) => text.includes(k));
  const hasQueryWord = ['보여', '알려', '조회', '목록', '있어', '있나', '뭐야', '뭘까', '뭐', '뭘'].some((k) => text.includes(k));
  const hasDateWord = ['오늘', '내일', '모레'].some((k) => text.includes(k));

  const isQuery =
    (hasDateWord && (hasScheduleWord || hasQueryWord)) ||
    (hasScheduleWord && hasQueryWord);

  if (!isQuery) return null;

  if (text.includes('모레')) return 'dayAfter';
  if (text.includes('내일')) return 'tomorrow';
  return 'today';
};

/** KST(UTC+9) 기준 오늘 날짜 (YYYY-MM-DD) */
const getTodayISO = (): string => {
  const now = new Date();
  const kst = new Date(now.getTime() + (now.getTimezoneOffset() + 540) * 60_000);
  const yyyy = kst.getFullYear();
  const mm = String(kst.getMonth() + 1).padStart(2, '0');
  const dd = String(kst.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

/** 날짜를 N일 이동 (YYYY-MM-DD) */
const addDays = (dateStr: string, days: number): string => {
  const d = new Date(dateStr + 'T00:00:00+09:00');
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

/** 조회 대상에 따른 날짜 계산 */
const getTargetDate = (target: QueryTarget, today: string): string => {
  switch (target) {
    case 'today': return today;
    case 'tomorrow': return addDays(today, 1);
    case 'dayAfter': return addDays(today, 2);
  }
};

/** 빠른 조회 응답 생성 */
const buildQueryResponse = (
  target: QueryTarget,
  targetDate: string,
  items: import('../../shared/notion.js').ScheduleItem[],
): string => {
  const formatted = formatDateShort(targetDate);

  // 오늘은 기존 크론 메시지 포맷 재사용
  if (target === 'today') {
    return buildReminderMessage(items, targetDate, formatted, false);
  }

  const label = target === 'tomorrow' ? '내일' : '모레';

  if (items.length === 0) {
    return `${label} ${formatted}은 일정 없어.`;
  }

  const list = formatScheduleList(items);
  return `${label} ${formatted} 일정이야.\n\n${list}`;
};

// --- 백로그 빠른 경로 ---

/** 백로그 조회 최대 길이 */
const BACKLOG_MAX_LENGTH = 20;

/** 백로그 조회 패턴 감지 (쓰기 키워드 없고 "백로그" 포함) */
export const detectBacklogQuery = (text: string): boolean => {
  if (text.length > BACKLOG_MAX_LENGTH) return false;
  if (!text.includes('백로그')) return false;
  if (WRITE_KEYWORDS.some((k) => text.includes(k))) return false;
  return true;
};

/** 백로그 목록 응답 생성 */
const buildBacklogResponse = (
  items: import('../../shared/notion.js').ScheduleItem[],
): string => {
  if (items.length === 0) {
    return '백로그에 쌓인 거 없어. 깔끔하네.';
  }

  const list = items
    .map((item) => {
      let line = item.title;
      if (item.category.length > 0) {
        line += ` [${item.category.join(', ')}]`;
      }
      if (item.hasStarIcon) line += ' ★';
      return line;
    })
    .join('\n');

  return `백로그 ${items.length}개야.\n\n${list}\n\n날짜 지정하고 싶은 거 있으면 말해줘.`;
};

// --- 에이전트 ---

export const createScheduleAgent = (
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

      // 1. 잡담 감지 (하이브리드: 키워드 → LLM 분류+응답)
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

      // 2. 조회 빠른 경로: "오늘 일정", "내일 뭐 있어" → SDK 직접 호출 (1-3초)
      const queryTarget = detectSimpleQuery(text);
      if (queryTarget) {
        // eslint-disable-next-line no-console
        console.log(`[Schedule Agent] 조회 빠른 경로: ${queryTarget}`);
        const today = getTodayISO();
        const targetDate = getTargetDate(queryTarget, today);
        const items = await queryTodaySchedules(notionClient, dbId, targetDate);
        if (items.length === 0) {
          const reply = buildQueryResponse(queryTarget, targetDate, items);
          await sendMessage(say, reply);
        } else {
          const { text: fallback, blocks } = buildScheduleBlocks(items, targetDate);
          await sendBlockMessage(say, fallback, blocks);
        }
        return;
      }

      // 3. 백로그 빠른 경로: "백로그", "백로그 보여줘" → SDK 직접 호출
      if (detectBacklogQuery(text)) {
        // eslint-disable-next-line no-console
        console.log(`[Schedule Agent] 백로그 빠른 경로`);
        const items = await queryBacklogItems(notionClient, dbId);
        const reply = buildBacklogResponse(items);
        await sendMessage(say, reply);
        return;
      }

      // 4. LLM 에이전트 경로: 자연어 일정 CRUD + 복잡 조회
      // eslint-disable-next-line no-console
      console.log(`[Schedule Agent] 메시지 수신: ${text}`);
      await sendMessage(say, getAckMessage());

      const loopResult = await runAgentLoop(llmClient, text, {
        label: 'Schedule Agent',
        buildSystemPrompt: () => buildSystemPrompt(dbId, getTodayString()),
        getTools: getScheduleTools,
      });

      // 변경 작업이면 해당 날짜 일정 목록을 Block Kit으로 별도 전송
      const reply = loopResult.text;
      if (hasMutation(loopResult)) {
        const today = getTodayISO();
        const targetDate = extractMutationDate(text, today);
        if (targetDate) {
          // eslint-disable-next-line no-console
          console.log(`[Schedule Agent] post-mutation 조회: ${targetDate}`);
          try {
            const items = await queryTodaySchedules(notionClient, dbId, targetDate);
            if (items.length > 0) {
              await sendMessage(say, reply);
              const { text: fallback, blocks } = buildScheduleBlocks(items, targetDate);
              await sendBlockMessage(say, fallback, blocks);
              return;
            }
          } catch (error: unknown) {
            console.error('[Schedule Agent] post-mutation 조회 오류:', error instanceof Error ? error.message : error);
          }
        }
      }
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
