import type { AgentHandler } from '../../router.js';
import type { LLMClient } from '../../shared/llm.js';
import type { Client as NotionClient } from '@notionhq/client';
import type { RoutineTemplate } from '../../shared/routine-notion.js';
import { runAgentLoopWithAck, getAckMessage } from '../../shared/agent-loop.js';
import { sendMessage } from '../../shared/slack.js';
import {
  queryTodayRoutineRecords,
  queryRoutineTemplates,
  queryLastRecordDate,
  shouldCreateToday,
  frequencyBadge,
} from '../../shared/routine-notion.js';
import {
  parseSleepTimes,
  calculateSleepMinutes,
  formatSleepDuration,
  formatTimeHHMM,
  calculateSleepStats,
  querySleepRecord,
  querySleepRecords,
  createSleepRecord,
  updateSleepRecord,
} from '../../shared/sleep-notion.js';
import { buildRoutineBlocks, buildFilteredRoutineBlocks } from './blocks.js';
import { buildRoutinePrompt, getTodayString } from './prompt.js';
import { getRoutineTools } from './tools.js';
import { ChatHistory } from '../../shared/chat-history.js';

/** "루틴" 포함이지만 체크리스트가 아닌 패턴 (인사, 감정 등 → 에이전트 루프로) */
const CHECKLIST_SKIP_PATTERNS = [
  '안녕', '하이', '반가', '잔소리꾼', 'ㅋㅋ', 'ㅎㅎ',
  '고마워', '화이팅', '파이팅', '수고',
];

const EXACT_KEYWORDS = new Set(['루틴', '루틴체크', '체크']);
const CRUD_KEYWORDS = ['추가', '삭제', '빼', '변경', '수정', '넣어', '만들어', '바꿔', '옮겨', '없애', '지워', '초기화', '시작', '꺼', '켜', '끄'];
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
    !CHECKLIST_SKIP_PATTERNS.some((p) => trimmed.includes(p))
  ) {
    for (const slot of TIME_SLOTS) {
      if (trimmed.includes(slot)) return slot;
    }
    return 'all';
  }
  return null;
};

/** 달성률/통계 조회 패턴 감지 (오늘 기준, 날짜 키워드 있으면 LLM으로) */
export const detectAnalyticsQuery = (text: string): boolean => {
  if (CRUD_KEYWORDS.some((k) => text.includes(k))) return false;
  if (DATE_KEYWORDS.some((k) => text.includes(k))) return false;
  return ANALYTICS_KEYWORDS.some((k) => text.includes(k));
};

/** 오늘 루틴 달성률을 계산하여 전송 */
const sendAchievementRate = async (
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

  const total = records.length;
  const completed = records.filter((r) => r.completed).length;
  const rate = Math.round((completed / total) * 100);

  // 시간대별 통계
  const slotStats = new Map<string, { total: number; done: number }>();
  for (const r of records) {
    const stat = slotStats.get(r.timeSlot) ?? { total: 0, done: 0 };
    stat.total++;
    if (r.completed) stat.done++;
    slotStats.set(r.timeSlot, stat);
  }

  let result = '오늘 루틴 진행 상황이야.\n';
  for (const slot of TIME_SLOTS) {
    const stat = slotStats.get(slot);
    if (stat) {
      const slotRate = Math.round((stat.done / stat.total) * 100);
      result += `\n*${slot}* ${stat.done}/${stat.total} (${slotRate}%)`;
    }
  }

  result += `\n\n전체 ${completed}/${total} (${rate}%)`;

  if (rate === 100) {
    result += '\n오늘 전부 다 했네, 대단해.';
  } else if (rate >= 70) {
    result += '\n잘하고 있어, 조금만 더 하자.';
  } else if (rate >= 40) {
    result += '\n반 정도 했네, 좀 더 힘내.';
  } else {
    result += '\n아직 많이 남았어, 얼른 시작하자.';
  }

  await sendMessage(say, result.trim());
};

// ─── 수면 감지 ──────────────────────────────────────────────────────

const SLEEP_BED_KEYWORDS = ['잤', '자서', '자고', '잠들', '취침', '잠 들'];
const SLEEP_WAKE_KEYWORDS = ['일어나', '일어났', '기상', '깼', '깸', '눈떴', '일어남'];
const SLEEP_QUERY_KEYWORDS = ['수면', '잠', '잤'];
const SLEEP_QUERY_MODIFIERS = ['얼마나', '몇', '시간', '평균', '기록', '통계', '보여', '알려'];
const SLEEP_PERIOD_KEYWORDS = ['이번주', '이번 주', '이번달', '이번 달', '한달', '한 달', '일주일'];

/** 수면 기록 패턴 감지: 취침+기상 키워드 동시 존재 */
export const detectSleepRecord = (text: string): boolean => {
  const hasBed = SLEEP_BED_KEYWORDS.some((k) => text.includes(k));
  const hasWake = SLEEP_WAKE_KEYWORDS.some((k) => text.includes(k));
  return hasBed && hasWake;
};

/** 수면 조회 패턴 감지: "수면" 또는 "잤" + 질문 키워드 */
export const detectSleepQuery = (text: string): boolean => {
  // "수면" 단독 포함
  if (text.includes('수면')) return true;
  // "잤" + 질문/조회 키워드
  const hasSleepRef = SLEEP_QUERY_KEYWORDS.some((k) => text.includes(k));
  const hasQueryIntent = SLEEP_QUERY_MODIFIERS.some((k) => text.includes(k));
  return hasSleepRef && hasQueryIntent;
};

/** 수면 기록 처리 (upsert) */
const handleSleepRecord = async (
  text: string,
  notionClient: NotionClient,
  sleepDbId: string,
  say: Parameters<AgentHandler>[1],
): Promise<boolean> => {
  const parsed = parseSleepTimes(text);
  if (!parsed) return false; // 파싱 실패 → LLM 폴백

  const { bedtime, wakeTime } = parsed;
  const minutes = calculateSleepMinutes(bedtime, wakeTime);
  const duration = formatSleepDuration(minutes);

  // 날짜 결정: 기본 = 어제 ("밤의 날짜")
  const today = getTodayISO();
  const date = addDays(today, -1);

  // upsert: 기존 기록 확인
  const existing = await querySleepRecord(notionClient, sleepDbId, date);

  if (existing) {
    await updateSleepRecord(notionClient, existing.id, bedtime, wakeTime, minutes);
    await sendMessage(say, `수면 기록 수정했어. ${bedtime}~${wakeTime}, ${duration}으로 바뀌었어.`);
  } else {
    await createSleepRecord(notionClient, sleepDbId, date, bedtime, wakeTime, minutes);
    await sendMessage(say, `수면 기록했어. ${bedtime}~${wakeTime}, ${duration} 잤네.`);
  }

  return true;
};

/** 수면 조회 처리 */
const handleSleepQuery = async (
  text: string,
  notionClient: NotionClient,
  sleepDbId: string,
  say: Parameters<AgentHandler>[1],
): Promise<void> => {
  const today = getTodayISO();
  const yesterday = addDays(today, -1);

  // 범위 감지
  const isPeriod = SLEEP_PERIOD_KEYWORDS.some((k) => text.includes(k));
  const isMonth = text.includes('달') || text.includes('월');

  if (!isPeriod && !isMonth) {
    // 단일 조회 (기본: 어제)
    const record = await querySleepRecord(notionClient, sleepDbId, yesterday);
    if (record) {
      const duration = formatSleepDuration(record.durationMinutes);
      await sendMessage(say, `어제 ${record.bedtime}~${record.wakeTime}, ${duration} 잤어.`);
    } else {
      await sendMessage(say, '어제 수면 기록이 없어. 기록 남기자~');
    }
    return;
  }

  // 범위 조회
  const days = isMonth ? 30 : 7;
  const startDate = addDays(today, -days);
  const records = await querySleepRecords(notionClient, sleepDbId, startDate, yesterday);

  if (records.length === 0) {
    const label = isMonth ? '이번 달' : '이번주';
    await sendMessage(say, `${label} 수면 기록이 없어.`);
    return;
  }

  const stats = calculateSleepStats(records);
  if (!stats) return;

  const label = isMonth ? '이번 달' : '이번주';
  const avgDuration = formatSleepDuration(stats.avgDurationMinutes);
  const avgBed = formatTimeHHMM(stats.avgBedtimeMinutes);
  const avgWake = formatTimeHHMM(stats.avgWakeTimeMinutes);

  let result = `${label} 수면 기록이야. (${stats.count}일)\n`;
  result += `평균 수면: ${avgDuration} | 평균 취침: ${avgBed} | 평균 기상: ${avgWake}\n`;

  for (const r of records) {
    const duration = formatSleepDuration(r.durationMinutes);
    result += `\n${formatDateLabel(r.date)} ${r.bedtime}~${r.wakeTime} (${duration})`;
  }

  await sendMessage(say, result.trim());
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
  sleepDbId?: string,
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

      // 2. "내일 루틴" → 빈도 기반 미리보기 (SDK 직접 계산)
      if (detectTomorrowRoutine(text)) {
        // eslint-disable-next-line no-console
        console.log(`[Routine Agent] 내일 루틴 미리보기`);
        await sendTomorrowPreview(notionClient, dbId, say);
        history.add(channelId, text, '[내일 루틴 미리보기 표시]');
        return;
      }

      // 3. "루틴" 포함 조회 → 체크리스트 반환 (시간대 필터 지원)
      const checklistTarget = detectChecklistTarget(text);
      if (checklistTarget) {
        await sendChecklist(notionClient, dbId, say, checklistTarget);
        history.add(channelId, text, `[${checklistTarget === 'all' ? '전체' : checklistTarget} 루틴 체크리스트 표시]`);
        return;
      }

      // 4. 달성률/통계 빠른 경로: "잘하고 있어?", "달성률", "얼마나 했어" → SDK 직접 계산
      if (detectAnalyticsQuery(text)) {
        // eslint-disable-next-line no-console
        console.log(`[Routine Agent] 달성률 조회`);
        await sendAchievementRate(notionClient, dbId, say);
        history.add(channelId, text, '[오늘 루틴 달성률 표시]');
        return;
      }

      // 5. 수면 기록 빠른 경로: "N시에 자서 N시에 일어났어" → SDK 직접 (upsert)
      if (sleepDbId && detectSleepRecord(text)) {
        // eslint-disable-next-line no-console
        console.log(`[Routine Agent] 수면 기록`);
        const handled = await handleSleepRecord(text, notionClient, sleepDbId, say);
        if (handled) {
          history.add(channelId, text, '[수면 기록 저장]');
          return;
        }
        // 파싱 실패 시 LLM 폴백
      }

      // 6. 수면 조회 빠른 경로: "이번주 수면시간", "어제 몇 시간 잤어?"
      if (sleepDbId && detectSleepQuery(text)) {
        // eslint-disable-next-line no-console
        console.log(`[Routine Agent] 수면 조회`);
        await handleSleepQuery(text, notionClient, sleepDbId, say);
        history.add(channelId, text, '[수면 기록 조회]');
        return;
      }

      // 7. LLM 에이전트 경로: 잡담 / 액션 / 혼합 모두 LLM이 자율 판단
      // eslint-disable-next-line no-console
      console.log(`[Routine Agent] 메시지 수신`);

      const loopResult = await runAgentLoopWithAck(
        llmClient, text,
        { label: 'Routine Agent', buildSystemPrompt: () => buildRoutinePrompt(dbId, getTodayString(), sleepDbId) + ctx, getTools: getRoutineTools },
        () => sendMessage(say, getAckMessage()),
      );
      await sendMessage(say, loopResult.text);
      history.add(channelId, text, loopResult.text);
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Routine Agent] 처리 오류: ${errorMsg.slice(0, 500)}`);
      await sendMessage(say, '일시적인 오류가 발생했어. 다시 한번 말해줘.');
    }
  };
};
