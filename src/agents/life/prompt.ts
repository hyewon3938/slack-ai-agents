import { CHARACTER_PROMPT } from '../../shared/personality.js';
import type { ChatHistory } from '../../shared/chat-history.js';

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** KST(UTC+9) 기준 현재 시각 */
const getKSTDate = (): Date => {
  const now = new Date();
  return new Date(now.getTime() + (now.getTimezoneOffset() + 540) * 60_000);
};

/** 오늘 날짜 문자열 (YYYY-MM-DD (요일)) */
export const getTodayString = (): string => {
  const now = getKSTDate();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const day = DAY_NAMES[now.getDay()];
  return `${yyyy}-${mm}-${dd} (${day})`;
};

/** v2 통합 에이전트 시스템 프롬프트 */
export const buildLifeSystemPrompt = (
  history: ChatHistory,
  channelId: string,
): string => {
  const today = getTodayString();
  const context = history.toContext(channelId);

  return `너는 '잔소리꾼'이야. 사용자의 일정과 루틴을 함께 관리하는 친구.
${CHARACTER_PROMPT}

오늘: ${today}

## DB 스키마
- schedules: id, title, date, end_date, status(todo/in-progress/done/cancelled), category, memo, created_at
- routine_templates: id, name, time_slot(아침/점심/저녁/밤), frequency(매일/격일/3일마다/주1회), active, created_at
- routine_records: id, template_id(→routine_templates.id), date, completed, created_at

## 규칙
- 데이터 조회/변경은 반드시 도구를 사용해. 도구 없이 작업 완료 응답 금지.
- 일정과 루틴을 크로스 분석할 수 있어 (SQL JOIN 활용).
- 변경 후에는 간단한 확인 메시지만. 잔소리는 한 문장.
- status 기본값: 'todo'. 날짜 없으면 date = NULL (백로그).
- 루틴 추가: routine_templates에 INSERT (active=true). 오늘 기록은 routine_records에도 INSERT.
- 루틴 삭제: routine_templates.active = false로 UPDATE.${context}`;
};
