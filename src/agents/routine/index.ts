import type { AgentHandler } from '../../router.js';
import type { LLMClient } from '../../shared/llm.js';
import type { Client as NotionClient } from '@notionhq/client';
import type { RoutineTemplate } from '../../shared/routine-notion.js';
import { classifyMessage, respondCasualChat } from '../../shared/casual-chat.js';
import { runAgentLoop, getAckMessage } from '../../shared/agent-loop.js';
import { sendMessage } from '../../shared/slack.js';
import { getAgentRole, getAgentContext } from '../../shared/personality.js';
import {
  queryTodayRoutineRecords,
  queryRoutineTemplates,
  queryLastRecordDate,
  shouldCreateToday,
  frequencyBadge,
} from '../../shared/routine-notion.js';
import { buildRoutineBlocks, buildFilteredRoutineBlocks } from './blocks.js';
import { buildRoutinePrompt, getTodayString } from './prompt.js';
import { getRoutineTools } from './tools.js';
import { ChatHistory } from '../../shared/chat-history.js';

const CASUAL_CHAT_MAX_LENGTH = 80;

/** 이 표현이 포함되면 키워드 무관하게 잡담으로 처리 */
const CASUAL_OVERRIDES = [
  '화이팅', '파이팅', '해볼게', '할게', '잘할게', '고마워', '수고',
  '잘 자', '알겠어', '그럴게', '응 알겠', 'ㅋㅋ', 'ㅎㅎ',
  '응원', '해봐야지', '해야지', '할 수 있겠지', '힘내', '힘들', '힘드', '힘든',
  '잘하고 있', '괜찮', '어떡해', '어떻게 하지', '피곤', '귀찮', '지쳤', '싫어',
];

const EXACT_KEYWORDS = new Set(['루틴', '루틴체크', '체크']);
const CRUD_KEYWORDS = ['추가', '삭제', '빼', '변경', '수정', '넣어', '만들어', '바꿔', '옮겨', '없애', '지워', '초기화', '시작', '꺼', '켜', '끄'];
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

/** 날짜를 N일 이동 (YYYY-MM-DD) */
const addDays = (dateStr: string, days: number): string => {
  const d = new Date(dateStr + 'T00:00:00+09:00');
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** "3/8 (토)" 형태 날짜 라벨 */
const formatDateLabel = (dateStr: string): string => {
  const d = new Date(dateStr + 'T00:00:00+09:00');
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const dayName = DAY_NAMES[d.getDay()];
  return `${m}/${day} (${dayName})`;
};

const TIME_SLOTS = ['아침', '점심', '저녁', '밤'] as const;
type ChecklistTarget = 'all' | typeof TIME_SLOTS[number];

/** "루틴" 포함 조회 요청 감지 + 시간대 판별 (null이면 체크리스트 아님) */
export const detectChecklistTarget = (text: string): ChecklistTarget | null => {
  const trimmed = text.trim();
  if (EXACT_KEYWORDS.has(trimmed)) return 'all';
  if (
    trimmed.includes('루틴') &&
    !CRUD_KEYWORDS.some((k) => trimmed.includes(k)) &&
    !ANALYTICS_KEYWORDS.some((k) => trimmed.includes(k)) &&
    !DATE_KEYWORDS.some((k) => trimmed.includes(k)) &&
    !CASUAL_OVERRIDES.some((p) => trimmed.includes(p))
  ) {
    for (const slot of TIME_SLOTS) {
      if (trimmed.includes(slot)) return slot;
    }
    return 'all';
  }
  return null;
};

/** "내일 루틴" 미리보기 패턴 감지 */
export const detectTomorrowRoutine = (text: string): boolean => {
  if (!text.includes('내일')) return false;
  if (!text.includes('루틴')) return false;
  if (CRUD_KEYWORDS.some((k) => text.includes(k))) return false;
  return true;
};

/** 내일 루틴 미리보기: 활성 템플릿 + 빈도 기반 필터링 */
const sendTomorrowPreview = async (
  notionClient: NotionClient,
  dbId: string,
  say: Parameters<AgentHandler>[1],
): Promise<void> => {
  const today = getTodayISO();
  const tomorrow = addDays(today, 1);

  const templates = await queryRoutineTemplates(notionClient, dbId);

  // 빈도 기반 필터: 내일 실행 대상만 선별
  const tomorrowTemplates: RoutineTemplate[] = [];
  for (const t of templates) {
    if (t.frequency === '매일') {
      tomorrowTemplates.push(t);
    } else {
      const lastDate = await queryLastRecordDate(notionClient, dbId, t.title, t.timeSlot);
      if (shouldCreateToday(t.frequency, lastDate, tomorrow)) {
        tomorrowTemplates.push(t);
      }
    }
  }

  if (tomorrowTemplates.length === 0) {
    await sendMessage(say, `내일 ${formatDateLabel(tomorrow)} 루틴은 없어.`);
    return;
  }

  // 시간대별 그룹핑
  const grouped = new Map<string, RoutineTemplate[]>();
  for (const t of tomorrowTemplates) {
    const list = grouped.get(t.timeSlot) ?? [];
    list.push(t);
    grouped.set(t.timeSlot, list);
  }

  let result = `내일 ${formatDateLabel(tomorrow)} 루틴이야.\n`;
  for (const slot of TIME_SLOTS) {
    const items = grouped.get(slot);
    if (items && items.length > 0) {
      result += `\n*${slot}*\n`;
      for (const t of items) {
        const badge = frequencyBadge(t.frequency);
        result += `· ${t.title}${badge ? ' ' + badge : ''}\n`;
      }
    }
  }

  await sendMessage(say, result.trim());
};

/** 오늘 루틴 체크리스트를 조회하여 전송 */
const sendChecklist = async (
  notionClient: NotionClient,
  dbId: string,
  say: Parameters<AgentHandler>[1],
  target: ChecklistTarget = 'all',
): Promise<void> => {
  const today = getTodayISO();
  const records = await queryTodayRoutineRecords(notionClient, dbId, today);

  if (records.length === 0) {
    await sendMessage(say, '오늘 루틴 기록이 없어. 아침 알림에서 자동으로 생성돼.');
    return;
  }

  // 시간대 필터링
  if (target !== 'all') {
    const slotRecords = records.filter((r) => r.timeSlot === target);
    if (slotRecords.length === 0) {
      await sendMessage(say, `${target} 루틴은 없어.`);
      return;
    }
    const { text: msgText, blocks } = buildFilteredRoutineBlocks(records, today, [target]);
    await say({ text: msgText, blocks });
    return;
  }

  // 전체
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
  const history = new ChatHistory();

  return async (message, say): Promise<void> => {
    try {
      if (!('text' in message) || !message.text) {
        return;
      }

      const text = message.text.trim();
      const channelId = 'channel' in message ? (message.channel as string) : 'default';
      const ctx = history.toContext(channelId);

      // 1. 정확 매칭 빠른 경로: "루틴", "체크" → LLM 없이 즉시 체크리스트
      if (EXACT_KEYWORDS.has(text)) {
        await sendChecklist(notionClient, dbId, say);
        history.add(channelId, text, '[오늘 루틴 체크리스트 표시]');
        return;
      }

      // 2. 잡담 감지 (하이브리드: 키워드 → LLM 분류+응답)
      const result = await classifyMessage(
        llmClient, text, ACTION_KEYWORDS, CASUAL_CHAT_MAX_LENGTH,
        AGENT_CONTEXT, AGENT_ROLE, CASUAL_OVERRIDES, ctx,
      );
      if (result.intent === 'casual') {
        // eslint-disable-next-line no-console
        console.log(`[Routine Agent] 잡담 감지`);
        const reply = result.casualReply ?? await respondCasualChat(llmClient, text, AGENT_ROLE, ctx);
        await sendMessage(say, reply);
        history.add(channelId, text, reply);
        return;
      }

      // 3. "내일 루틴" → 빈도 기반 미리보기 (SDK 직접 계산)
      if (detectTomorrowRoutine(text)) {
        // eslint-disable-next-line no-console
        console.log(`[Routine Agent] 내일 루틴 미리보기`);
        await sendTomorrowPreview(notionClient, dbId, say);
        history.add(channelId, text, '[내일 루틴 미리보기 표시]');
        return;
      }

      // 4. "루틴" 포함 조회 → 체크리스트 반환 (시간대 필터 지원)
      const checklistTarget = detectChecklistTarget(text);
      if (checklistTarget) {
        await sendChecklist(notionClient, dbId, say, checklistTarget);
        history.add(channelId, text, `[${checklistTarget === 'all' ? '전체' : checklistTarget} 루틴 체크리스트 표시]`);
        return;
      }

      // 5. LLM 에이전트 경로: 자연어 루틴 CRUD
      // eslint-disable-next-line no-console
      console.log(`[Routine Agent] 메시지 수신`);
      await sendMessage(say, getAckMessage());

      const loopResult = await runAgentLoop(llmClient, text, {
        label: 'Routine Agent',
        buildSystemPrompt: () => buildRoutinePrompt(dbId, getTodayString()) + ctx,
        getTools: getRoutineTools,
      });
      await sendMessage(say, loopResult.text);
      history.add(channelId, text, loopResult.text);
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Routine Agent] 처리 오류: ${errorMsg.slice(0, 500)}`);
      await sendMessage(say, '일시적인 오류가 발생했어. 다시 한번 말해줘.');
    }
  };
};
