import type { AgentHandler } from '../../router.js';
import type { LLMClient, LLMMessage, LLMToolCall } from '../../shared/llm.js';
import type { Client as NotionClient } from '@notionhq/client';
import { isCasualChat, respondCasualChat } from '../../shared/casual-chat.js';
import { callMCPTool } from '../../shared/mcp-client.js';
import { sendMessage } from '../../shared/slack.js';
import { queryTodayRoutineRecords } from '../../shared/routine-notion.js';
import { buildRoutineBlocks } from './blocks.js';
import { buildRoutinePrompt, getTodayString } from './prompt.js';
import { getRoutineTools } from './tools.js';

const MAX_TOOL_ROUNDS = 10;
const MAX_RETRIES = 2;
const MAX_RATE_LIMIT_RETRIES = 3;
const LLM_TIMEOUT_MS = 60_000;
const TOOL_TIMEOUT_MS = 30_000;

/** Promise에 타임아웃을 적용하는 유틸리티 */
const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout (${ms / 1000}s)`)), ms),
    ),
  ]);
};

const AGENT_ROLE = "너는 '잔소리꾼'이라는 이름의 루틴 관리 친구야.";
const CASUAL_CHAT_MAX_LENGTH = 50;

/** 이 표현이 포함되면 키워드 무관하게 잡담으로 처리 */
const CASUAL_OVERRIDES = [
  '화이팅', '파이팅', '해볼게', '할게', '잘할게', '고마워', '수고',
  '잘 자', '알겠어', '그럴게', '응 알겠', 'ㅋㅋ', 'ㅎㅎ',
];

const EXACT_KEYWORDS = new Set(['루틴', '루틴체크', '체크']);
const CRUD_KEYWORDS = ['추가', '삭제', '빼', '변경', '수정', '넣어', '만들어', '바꿔', '옮겨', '없애', '지워', '초기화', '시작'];
const ANALYTICS_KEYWORDS = ['얼마나', '통계', '달성', '지켰', '기록', '분석', '몇', '퍼센트', '잘하고'];
const DATE_KEYWORDS = ['내일', '모레', '어제', '그제', '이번주', '다음주', '저번주', '지난주'];
const ACTION_KEYWORDS = [...CRUD_KEYWORDS, ...ANALYTICS_KEYWORDS, '루틴', '보여', '알려', '조회', '목록'];

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
    !DATE_KEYWORDS.some((k) => trimmed.includes(k))
  ) return true;
  return false;
};


const parseRetryDelay = (errorMsg: string, defaultMs: number): number => {
  const match = /retry in (\d+(?:\.\d+)?)\s*s/i.exec(errorMsg);
  if (match?.[1]) {
    return Math.ceil(Number(match[1]) * 1000);
  }
  return defaultMs;
};

const executeToolCalls = async (
  toolCalls: LLMToolCall[],
): Promise<LLMMessage[]> => {
  const results = await Promise.all(
    toolCalls.map(async (tc): Promise<LLMMessage> => {
      // eslint-disable-next-line no-console
      console.log(`[Routine Agent] 도구 호출: ${tc.name}`);
      try {
        const result = await withTimeout(
          callMCPTool(tc.name, tc.arguments),
          TOOL_TIMEOUT_MS,
          `도구 ${tc.name}`,
        );
        // eslint-disable-next-line no-console
        console.log(`[Routine Agent] 도구 결과: ${tc.name}`, result.slice(0, 200));
        return { role: 'tool', content: result, toolCallId: tc.id };
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : '알 수 없는 오류';
        console.error(`[Routine Agent] 도구 오류: ${tc.name}`, errorMessage);
        return {
          role: 'tool',
          content: `도구 실행 오류: ${errorMessage}`,
          toolCallId: tc.id,
        };
      }
    }),
  );

  return results;
};

const runAgentLoop = async (
  llmClient: LLMClient,
  userText: string,
  dbId: string,
): Promise<string> => {
  const today = getTodayString();
  const systemPrompt = buildRoutinePrompt(dbId, today);
  const tools = await getRoutineTools();

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userText },
  ];

  let retryCount = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // eslint-disable-next-line no-console
    console.log(`[Routine Agent] LLM 호출 (round ${round + 1})`);

    let response;
    try {
      response = await withTimeout(
        llmClient.chat(messages, tools),
        LLM_TIMEOUT_MS,
        'LLM 호출',
      );
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Routine Agent] LLM 호출 오류 (round ${round + 1}):`, errorMsg.slice(0, 500));

      const isRateLimit = /\b(429|RESOURCE_EXHAUSTED|quota)\b/i.test(errorMsg);
      const isTransient = /\b(500|503|429|INTERNAL|UNAVAILABLE|DEADLINE_EXCEEDED|overloaded|high demand|fetch failed|timeout)\b/i.test(errorMsg);
      const maxRetries = isRateLimit ? MAX_RATE_LIMIT_RETRIES : MAX_RETRIES;

      if (isTransient && retryCount < maxRetries) {
        retryCount++;
        const delay = isRateLimit
          ? parseRetryDelay(errorMsg, 60_000)
          : retryCount * 3000;
        // eslint-disable-next-line no-console
        console.log(`[Routine Agent] 재시도 (${retryCount}/${maxRetries}, ${Math.round(delay / 1000)}s 대기)`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      if (isRateLimit) {
        return 'API 호출 한도를 초과했어. 잠시 후에 다시 말해줘.';
      }

      return '일시적인 오류가 발생했어. 다시 한번 말해줘.';
    }

    if (response.finishReason === 'stop') {
      return response.text ?? '처리했어.';
    }

    if (response.finishReason === 'tool_calls' && response.toolCalls.length > 0) {
      retryCount = 0;
      messages.push({
        role: 'assistant',
        content: response.text ?? '',
        toolCalls: response.toolCalls,
      });

      const toolResults = await executeToolCalls(response.toolCalls);
      messages.push(...toolResults);
      continue;
    }

    if (response.finishReason === 'error' && retryCount < MAX_RETRIES) {
      retryCount++;
      // eslint-disable-next-line no-console
      console.log(`[Routine Agent] MALFORMED_FUNCTION_CALL 재시도 (${retryCount}/${MAX_RETRIES})`);
      continue;
    }

    if (response.finishReason === 'error') {
      return '도구 호출에 문제가 생겼어. 다시 한번 말해줘.';
    }

    return response.text ?? '처리 중 문제가 생겼어. 다시 말해줘.';
  }

  return '요청이 너무 복잡해. 좀 더 간단하게 말해줘.';
};

const ACK_MESSAGES = [
  '잠깐만, 확인해볼게.',
  '잠시만, 보고 올게.',
  '알겠어, 잠깐만.',
  '오케이, 확인 중.',
  '잠깐, 찾아볼게.',
  '알겠어, 금방 할게.',
];

const getAckMessage = (): string =>
  ACK_MESSAGES[Math.floor(Math.random() * ACK_MESSAGES.length)];

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

      // 키워드 빠른 경로: "루틴" → LLM 없이 체크리스트 반환
      if (isChecklistRequest(text)) {
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
        return;
      }

      // 잡담 빠른 경로: 도구 없이 짧은 프롬프트로 LLM 직접 응답 (ack 생략)
      if (isCasualChat(text, ACTION_KEYWORDS, CASUAL_CHAT_MAX_LENGTH, CASUAL_OVERRIDES)) {
        // eslint-disable-next-line no-console
        console.log(`[Routine Agent] 잡담 감지`);
        const reply = await respondCasualChat(llmClient, text, AGENT_ROLE);
        await sendMessage(say, reply);
        return;
      }

      // LLM 에이전트 경로: 자연어 루틴 CRUD
      // eslint-disable-next-line no-console
      console.log(`[Routine Agent] 메시지 수신`);
      await sendMessage(say, getAckMessage());
      const reply = await runAgentLoop(llmClient, text, dbId);
      await sendMessage(say, reply);
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Routine Agent] 처리 오류: ${errorMsg.slice(0, 500)}`);
      await sendMessage(say, '일시적인 오류가 발생했어. 다시 한번 말해줘.');
    }
  };
};
