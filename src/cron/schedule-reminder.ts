import type { ScheduleItem } from '../shared/notion.js';

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'] as const;

// --- 랜덤 선택 ---

const pickRandom = <T>(arr: readonly T[]): T =>
  arr[Math.floor(Math.random() * arr.length)];

// --- 날짜 포맷 ---

/** "YYYY-MM-DD" → "3/7(토)" */
export const formatDateShort = (dateStr: string): string => {
  const d = new Date(dateStr + 'T00:00:00+09:00');
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const dayName = DAY_NAMES[d.getDay()];
  return `${month}/${day}(${dayName})`;
};

// --- 일정 포맷 (에이전트와 동일) ---

const formatTime = (dateStr: string): string | null => {
  if (dateStr.length <= 10) return null;
  const timePart = dateStr.slice(11, 16);
  if (!timePart) return null;
  const parts = timePart.split(':');
  const h = parts[0];
  const m = parts[1];
  if (!h || m === undefined) return null;
  return `${Number(h)}:${m}`;
};

/** 기간 일정이면 "3/5(수)~3/10(월)" 형식으로 반환 */
const formatDateRange = (item: ScheduleItem): string | null => {
  if (!item.date?.end) return null;
  const start = formatDateShort(item.date.start.slice(0, 10));
  const end = formatDateShort(item.date.end.slice(0, 10));
  return `${start}~${end}`;
};

const formatItem = (item: ScheduleItem): string => {
  const isAppointment = item.category.includes('약속');
  const star = item.hasStarIcon ? ' ★' : '';
  const range = formatDateRange(item);
  const rangePart = range ? ` ${range}` : '';

  if (isAppointment) {
    const time = item.date ? formatTime(item.date.start) : null;
    const timePart = time ? ` ${time}` : '';
    return `${item.title}${timePart}${rangePart} [약속]${star}`;
  }

  if (item.status === 'done') return `~${item.title}~${rangePart}${star}`;
  if (item.status === 'in-progress') return `► ${item.title}${rangePart}${star}`;
  return `${item.title}${rangePart}${star}`;
};

const sortItems = (items: ScheduleItem[]): ScheduleItem[] => {
  const statusOrder: Record<string, number> = {
    done: 0,
    'in-progress': 1,
    todo: 2,
  };

  return [...items].sort((a, b) => {
    const aIsAppointment = a.category.includes('약속');
    const bIsAppointment = b.category.includes('약속');

    if (aIsAppointment && !bIsAppointment) return -1;
    if (!aIsAppointment && bIsAppointment) return 1;

    if (!aIsAppointment && !bIsAppointment) {
      const aOrder = statusOrder[a.status ?? 'todo'] ?? 2;
      const bOrder = statusOrder[b.status ?? 'todo'] ?? 2;
      return aOrder - bOrder;
    }

    return 0;
  });
};

const formatScheduleList = (items: ScheduleItem[]): string => {
  const sorted = sortItems(items);
  return sorted.map(formatItem).join('\n');
};

// --- 문구 ---

const GREETING_MESSAGES = [
  '오늘 {date} 일정 공유할게.',
  '{date} 일정 현황이야.',
  '오늘 {date} 일정 정리해봤어.',
  '{date} 뭐가 있나 보자.',
  '오늘 {date} 일정 한번 볼까.',
] as const;

const REMAINING_COMMENTS = [
  '아직 해야 할 일이 남아있네. 조금만 더 힘내보자.',
  '남은 일정이 있어. 할 수 있어, 화이팅!',
  '아직 할 일이 좀 남았어. 하나씩 해치우자.',
  '남은 거 마저 끝내보자. 거의 다 왔어!',
] as const;

const NIGHT_COMPLETE_MESSAGES = [
  '오늘 할일 다 완료했네! 고생했어.',
  '다 해냈다! 오늘 하루 수고 많았어.',
  '전부 끝냈네! 잘했어, 푹 쉬어.',
  '오늘 할 거 다 끝! 수고했어, 편하게 마무리해.',
] as const;

const NIGHT_INCOMPLETE_MESSAGES = [
  '아직 할 일이 남았네. 수정하거나 정리할 거 있으면 말해줘!',
  '남은 일정이 있어. 내일로 미루거나 수정할 거 있으면 알려줘.',
  '마무리 시간이야. 아직 남은 게 있는데, 정리할 거 있어?',
  '하루 끝! 남은 일정 확인해보고, 수정할 거 있으면 말해.',
] as const;

const NO_SCHEDULE_MESSAGES = [
  '오늘 {date} 일정은 없어.',
  '{date}은 일정 없는 날이야.',
  '오늘은 일정 없이 쉬는 날!',
] as const;

const NO_SCHEDULE_NIGHT_MESSAGES = [
  '오늘은 일정 없이 지나갔네. 푹 쉬어.',
  '오늘 일정 없었어. 편하게 마무리해.',
] as const;

// --- 미완료 판단 ---

/**
 * 밤 23시 마무리 기준 미완료 여부 판단.
 * 기간 일정은 마지막 날이 아니면 미완료로 세지 않음.
 */
const isIncompleteForNight = (item: ScheduleItem, today: string): boolean => {
  if (item.category.includes('약속')) return false;
  if (item.status === 'done' || item.status === 'cancelled') return false;

  // 기간 일정: 마지막 날이 아니면 진행 중으로 간주
  if (item.date?.end) {
    const endDate = item.date.end.slice(0, 10);
    if (endDate !== today) return false;
  }

  return true;
};

/** 일반 시간대 미완료 여부 (약속 제외, done/cancelled 제외) */
const isRemaining = (item: ScheduleItem): boolean => {
  if (item.category.includes('약속')) return false;
  return item.status !== 'done' && item.status !== 'cancelled';
};

// --- 메시지 빌더 ---

export const buildReminderMessage = (
  items: ScheduleItem[],
  today: string,
  todayFormatted: string,
  isNight: boolean,
): string => {
  if (items.length === 0) {
    if (isNight) {
      return pickRandom(NO_SCHEDULE_NIGHT_MESSAGES);
    }
    return pickRandom(NO_SCHEDULE_MESSAGES).replace('{date}', todayFormatted);
  }

  const list = formatScheduleList(items);

  if (!isNight) {
    const greeting = pickRandom(GREETING_MESSAGES).replace('{date}', todayFormatted);
    const remainingCount = items.filter(isRemaining).length;
    const comment =
      remainingCount > 0 && Math.random() < 0.4
        ? `\n\n${pickRandom(REMAINING_COMMENTS)}`
        : '';
    return `${greeting}\n\n${list}${comment}`;
  }

  // 밤 마무리
  const incompleteCount = items.filter((i) =>
    isIncompleteForNight(i, today),
  ).length;

  if (incompleteCount === 0) {
    return `${pickRandom(NIGHT_COMPLETE_MESSAGES)}\n\n${list}`;
  }

  return `${pickRandom(NIGHT_INCOMPLETE_MESSAGES)}\n\n${list}`;
};
