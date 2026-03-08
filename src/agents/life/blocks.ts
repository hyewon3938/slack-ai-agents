/**
 * v2 Life Agent Block Kit 빌더.
 * v1(routine/blocks, schedule/blocks) 패턴 재사용, v1 import 없이 자체 구현.
 */

import type { KnownBlock } from '@slack/types';
import type { RoutineRecordRow, ScheduleRow } from '../../shared/life-queries.js';
import { frequencyBadge } from '../../shared/life-queries.js';

// ─── 상수 ───────────────────────────────────────────────

export const ROUTINE_ACTION_ID = 'life_routine_complete';
export const SCHEDULE_ACTION_ID = 'life_schedule_status';
export const POSTPONE_ACTION = 'postpone';

const TIME_SLOT_ORDER = ['아침', '점심', '저녁', '밤'] as const;
const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'] as const;

const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]!;

// ─── 날짜 포맷 ─────────────────────────────────────────

/** "YYYY-MM-DD" → "3/7(토)" */
export const formatDateShort = (dateStr: string): string => {
  const d = new Date(dateStr + 'T00:00:00+09:00');
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const dayName = DAY_NAMES[d.getDay()];
  return `${month}/${day}(${dayName})`;
};

// ─── 루틴 필터 인코딩/파싱 ──────────────────────────────

export interface SlotFilter {
  targetSlots: string[];
  incompleteFrom: string[];
}

const encodeFilter = (filter?: SlotFilter): string => {
  if (!filter || filter.targetSlots.length === 0) return '';
  return `|${filter.targetSlots.join(',')}|${filter.incompleteFrom.join(',')}`;
};

/** 버튼 value에서 recordId + 필터 컨텍스트 파싱 */
export const parseButtonValue = (
  value: string,
): { recordId: number; filter: SlotFilter | null } => {
  const parts = value.split('|');
  const recordId = Number(parts[0]);
  if (parts.length < 2 || !parts[1]) return { recordId, filter: null };
  const targetSlots = parts[1].split(',').filter(Boolean);
  const incompleteFrom = parts[2]?.split(',').filter(Boolean) ?? [];
  return { recordId, filter: { targetSlots, incompleteFrom } };
};

// ─── 루틴 체크리스트 ────────────────────────────────────

/** 루틴 체크리스트 Block Kit 빌드 */
export const buildRoutineBlocks = (
  records: RoutineRecordRow[],
  today: string,
  slotFilter?: SlotFilter,
): { text: string; blocks: KnownBlock[] } => {
  const blocks: KnownBlock[] = [];
  const todayFormatted = formatDateShort(today);

  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: `${todayFormatted} 루틴 체크`, emoji: true },
  });

  for (const slot of TIME_SLOT_ORDER) {
    const slotRecords = records.filter((r) => r.time_slot === slot);
    if (slotRecords.length === 0) continue;

    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*${slot}*` },
    });

    for (const record of slotRecords) {
      const badge = frequencyBadge(record.frequency);
      const suffix = badge ? ` ${badge}` : '';

      if (record.completed) {
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: `~${record.name}~${suffix} :white_check_mark:` },
        });
      } else {
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: `${record.name}${suffix}` },
          accessory: {
            type: 'button',
            text: { type: 'plain_text', text: '완료 ✓', emoji: true },
            action_id: ROUTINE_ACTION_ID,
            value: `${record.id}${encodeFilter(slotFilter)}`,
          },
        });
      }
    }
  }

  const total = records.length;
  const completed = records.filter((r) => r.completed).length;

  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `완료: ${completed}/${total}` }],
  });

  const text = `${todayFormatted} 루틴 체크 (${completed}/${total} 완료)`;
  return { text, blocks };
};

/** 시간대 필터링된 체크리스트 (크론 알림용) */
export const buildFilteredRoutineBlocks = (
  records: RoutineRecordRow[],
  today: string,
  targetSlots: readonly string[],
  includeIncompleteFrom?: readonly string[],
): { text: string; blocks: KnownBlock[] } => {
  const filtered = records.filter((r) => {
    if (targetSlots.includes(r.time_slot)) return true;
    if (includeIncompleteFrom?.includes(r.time_slot) && !r.completed) return true;
    return false;
  });

  const slotFilter: SlotFilter = {
    targetSlots: [...targetSlots],
    incompleteFrom: includeIncompleteFrom ? [...includeIncompleteFrom] : [],
  };

  return buildRoutineBlocks(filtered, today, slotFilter);
};

// ─── 아침/밤 메시지 (하드코딩) ──────────────────────────

const MORNING_100: ReadonlyArray<(pct: number) => string> = [
  (pct) => `어제 루틴 ${pct}%. 다 했네, 역시. 오늘도 이대로 가.`,
  (pct) => `어제 루틴 ${pct}%. 잘했어. 오늘도 이 기세로.`,
  (pct) => `어제 루틴 ${pct}%. 빠짐없이 다 챙겼네. 오늘도 그렇게 하자.`,
];

const MORNING_GOOD: ReadonlyArray<(pct: number) => string> = [
  (pct) => `어제 루틴 ${pct}%. 나쁘진 않은데, 빠뜨린 거 좀 신경 써.`,
  (pct) => `어제 루틴 ${pct}%. 거의 다 했네. 남은 것도 챙기자.`,
  (pct) => `어제 루틴 ${pct}%. 잘하고 있어. 빠진 것도 신경 쓰자.`,
];

const MORNING_BAD: ReadonlyArray<(pct: number) => string> = [
  (pct) => `어제 루틴 ${pct}%. 바빴어? 오늘은 좀 챙겨.`,
  (pct) => `어제 루틴 ${pct}%야. 몸은 괜찮아? 오늘은 하나씩 해보자.`,
  (pct) => `어제 루틴 ${pct}%. 좀 힘들었나. 오늘은 다시 해보자.`,
];

const MORNING_NO_RECORD: readonly string[] = [
  '어제 루틴 기록이 없네. 괜찮아? 오늘부터 다시 시작하자.',
  '어제 기록이 없어. 무슨 일 있었어? 오늘은 하나씩 해보자.',
  '어제 루틴을 못 챙겼네. 오늘은 하나씩 신경 써.',
];

const SLOT_FOCUS: Record<string, readonly string[]> = {
  '아침': [
    '아침 루틴을 주로 못 지켰네. 아침 쪽에 집중해 보자.',
    '아침이 제일 약하네. 내일은 아침부터 챙겨.',
  ],
  '점심': [
    '점심 루틴을 자주 놓쳤네. 점심 시간 좀 신경 써.',
    '점심 쪽이 약해. 점심 루틴 챙기는 게 우선이야.',
  ],
  '저녁': [
    '저녁 루틴을 많이 놓쳤네. 저녁에 여유 좀 가져.',
    '저녁 쪽이 취약해. 저녁 루틴 다시 챙겨봐.',
  ],
  '밤': [
    '밤 루틴을 자주 빠뜨렸네. 자기 전에 체크하는 습관 들여.',
    '밤 쪽이 약해. 자기 전 루틴 챙겨.',
  ],
};

/** 어제 기록 중 달성률이 가장 낮은 시간대 분석 */
const buildSlotAnalysis = (records: RoutineRecordRow[]): string | null => {
  const slotStats = TIME_SLOT_ORDER.map((slot) => {
    const slotRecords = records.filter((r) => r.time_slot === slot);
    if (slotRecords.length === 0) return null;
    const completedCount = slotRecords.filter((r) => r.completed).length;
    return { slot, pct: Math.round((completedCount / slotRecords.length) * 100) };
  }).filter((s): s is NonNullable<typeof s> => s !== null);

  if (slotStats.length < 2) return null;

  const worstSlot = slotStats.reduce((worst, curr) => (curr.pct < worst.pct ? curr : worst));
  if (worstSlot.pct >= 70) return null;

  const msgs = SLOT_FOCUS[worstSlot.slot];
  return msgs ? pick(msgs) : null;
};

/** 아침 인사 블록 (어제 완료율 + 시간대 분석) */
export const buildMorningGreetingBlocks = (
  yesterdayRecords: RoutineRecordRow[],
): KnownBlock[] => {
  const blocks: KnownBlock[] = [];

  if (yesterdayRecords.length > 0) {
    const total = yesterdayRecords.length;
    const completed = yesterdayRecords.filter((r) => r.completed).length;
    const pct = Math.round((completed / total) * 100);

    let greeting: string;
    if (pct === 100) {
      greeting = pick(MORNING_100)(pct);
    } else if (pct >= 70) {
      greeting = pick(MORNING_GOOD)(pct);
    } else {
      greeting = pick(MORNING_BAD)(pct);
    }

    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: greeting } });

    const slotAnalysis = buildSlotAnalysis(yesterdayRecords);
    if (slotAnalysis) {
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: slotAnalysis } });
    }
  } else {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: pick(MORNING_NO_RECORD) },
    });
  }

  return blocks;
};

const NIGHT_COMPLETE: readonly string[] = [
  '오늘 루틴 전부 완료. 수고했어, 푹 쉬어.',
  '다 했네. 잘했어. 이제 쉬어.',
  '오늘도 다 챙겼네. 수고했어.',
];

const NIGHT_INCOMPLETE: ReadonlyArray<(c: number, t: number) => string> = [
  (c, t) => `오늘 루틴 ${c}/${t} 완료. 남은 건 내일 꼭 챙겨.`,
  (c, t) => `오늘 ${c}/${t} 달성. 아쉽지만 내일 다시 하자.`,
  (c, t) => `오늘 루틴 ${c}/${t}이야. 남은 것도 신경 써.`,
];

/** 밤 요약 블록 (전체 체크리스트 + 마무리 메시지) */
export const buildNightSummaryBlocks = (
  records: RoutineRecordRow[],
  today: string,
): { text: string; blocks: KnownBlock[] } => {
  const result = buildRoutineBlocks(records, today);
  const total = records.length;
  const completed = records.filter((r) => r.completed).length;

  const finalText = total === completed
    ? pick(NIGHT_COMPLETE)
    : pick(NIGHT_INCOMPLETE)(completed, total);

  result.blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: `\n${finalText}` },
  });

  return result;
};

// ─── 일정 블록 ──────────────────────────────────────────

interface CategoryGroup {
  category: string;
  items: ScheduleRow[];
}

const STATUS_ORDER: Record<string, number> = {
  done: 0,
  'in-progress': 1,
  todo: 2,
};

/** 일정을 카테고리별로 그룹핑 */
const groupByCategory = (items: ScheduleRow[]): CategoryGroup[] => {
  const categoryMap = new Map<string, ScheduleRow[]>();

  for (const item of items) {
    const cat = item.category ?? '미분류';
    if (!categoryMap.has(cat)) categoryMap.set(cat, []);
    categoryMap.get(cat)!.push(item);
  }

  const result: CategoryGroup[] = [];
  // 알파벳순, 미분류 맨 끝
  const categories = [...categoryMap.keys()].sort((a, b) => {
    if (a === '미분류') return 1;
    if (b === '미분류') return -1;
    return a.localeCompare(b, 'ko');
  });

  for (const cat of categories) {
    const items = categoryMap.get(cat)!;
    items.sort((a, b) => {
      const aOrder = STATUS_ORDER[a.status] ?? 2;
      const bOrder = STATUS_ORDER[b.status] ?? 2;
      return aOrder - bOrder;
    });
    result.push({ category: cat, items });
  }

  return result;
};

/** 일정 항목 포맷 */
const formatScheduleItem = (item: ScheduleRow): string => {
  const isAppointment = item.category === '약속';

  // 기간 일정 표시
  let rangePart = '';
  if (item.date && item.end_date) {
    rangePart = ` ${formatDateShort(item.date)}~${formatDateShort(item.end_date)}`;
  }

  if (isAppointment) return `${item.title}${rangePart}`;
  if (item.status === 'done') return `~${item.title}~${rangePart}`;
  if (item.status === 'in-progress') return `► ${item.title}${rangePart}`;
  return `${item.title}${rangePart}`;
};

/** overflow value 형식: "scheduleId|newStatus|targetDate" */
export const encodeOverflowValue = (
  scheduleId: number,
  newStatus: string,
  targetDate: string,
): string => `${scheduleId}|${newStatus}|${targetDate}`;

export const parseOverflowValue = (
  value: string,
): { scheduleId: number; newStatus: string; targetDate: string } => {
  const parts = value.split('|');
  return {
    scheduleId: Number(parts[0]),
    newStatus: parts[1]!,
    targetDate: parts[2]!,
  };
};

const STATUS_OPTIONS: { status: string; label: string }[] = [
  { status: 'done', label: '완료' },
  { status: 'in-progress', label: '진행중' },
  { status: 'todo', label: '할일' },
];

const buildOverflowOptions = (
  item: ScheduleRow,
  targetDate: string,
): Array<{ text: { type: 'plain_text'; text: string }; value: string }> => {
  const currentStatus = item.status ?? 'todo';
  const options = STATUS_OPTIONS
    .filter((opt) => opt.status !== currentStatus)
    .map((opt) => ({
      text: { type: 'plain_text' as const, text: opt.label },
      value: encodeOverflowValue(item.id, opt.status, targetDate),
    }));

  if (currentStatus !== 'done') {
    options.push({
      text: { type: 'plain_text' as const, text: '내일로 미루기' },
      value: encodeOverflowValue(item.id, POSTPONE_ACTION, targetDate),
    });
  }

  return options;
};

/** 일정 목록 Block Kit 빌드 (카테고리별 그룹핑 + overflow 메뉴) */
export const buildScheduleBlocks = (
  items: ScheduleRow[],
  targetDate: string,
  headerText?: string,
): { text: string; blocks: KnownBlock[] } => {
  const blocks: KnownBlock[] = [];
  const formatted = formatDateShort(targetDate);

  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: `*${headerText ?? `${formatted} 일정`}*` },
  });

  const groups = groupByCategory(items);

  for (const group of groups) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*[${group.category}]*` },
    });

    const noOverflowLines: string[] = [];

    const flushNoOverflow = (): void => {
      if (noOverflowLines.length === 0) return;
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: noOverflowLines.join('\n') },
      });
      noOverflowLines.length = 0;
    };

    for (const item of group.items) {
      const isAppointment = item.category === '약속';
      const itemText = formatScheduleItem(item);

      if (isAppointment || !item.status) {
        noOverflowLines.push(itemText);
      } else {
        flushNoOverflow();
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: itemText },
          accessory: {
            type: 'overflow',
            action_id: SCHEDULE_ACTION_ID,
            options: buildOverflowOptions(item, targetDate),
          },
        });
      }
    }

    flushNoOverflow();
  }

  // 하단 통계 — 약속 제외
  const tasks = items.filter((i) => i.category !== '약속');
  const done = tasks.filter((i) => i.status === 'done').length;

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `${done}/${tasks.length} 완료` }],
  });

  const fallbackText = `${formatted} 일정 (${items.length}개)`;
  return { text: fallbackText, blocks };
};
