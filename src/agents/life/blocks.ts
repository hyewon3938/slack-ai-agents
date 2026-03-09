/**
 * v2 Life Agent Block Kit 빌더.
 * v1(routine/blocks, schedule/blocks) 패턴 재사용, v1 import 없이 자체 구현.
 */

import type { KnownBlock } from '@slack/types';
import type { RoutineRecordRow, ScheduleRow, SleepRecordRow } from '../../shared/life-queries.js';
import { frequencyBadge } from '../../shared/life-queries.js';
import { formatDateShort } from '../../shared/kst.js';

// ─── 상수 ───────────────────────────────────────────────

export const ROUTINE_ACTION_ID = 'life_routine_complete';
export const SCHEDULE_ACTION_ID = 'life_schedule_status';
export const POSTPONE_ACTION = 'postpone';
export const DELETE_ACTION = 'delete';
export const TOGGLE_IMPORTANT_ACTION = 'toggle_important';

const TIME_SLOT_ORDER = ['아침', '점심', '저녁', '밤'] as const;

const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]!;

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

// ─── 아침/밤 메시지 (LLM 생성 텍스트 기반) ─────────────

/** 아침 인사 블록 (LLM 생성 텍스트) */
export const buildMorningGreetingBlocks = (greetingText: string): KnownBlock[] => [
  { type: 'section', text: { type: 'mrkdwn', text: greetingText } },
];

/** 밤 요약 블록 (전체 체크리스트 + LLM 마무리 메시지) */
export const buildNightSummaryBlocks = (
  records: RoutineRecordRow[],
  today: string,
  summaryText: string,
): { text: string; blocks: KnownBlock[] } => {
  const result = buildRoutineBlocks(records, today);

  result.blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: `\n${summaryText}` },
  });

  return result;
};

// ─── 수면 리마인더 ──────────────────────────────────────

const SLEEP_REMINDER_MORNING: readonly string[] = [
  '좋은 아침! 어제 수면 기록 아직 안 남겼지? 일어난 김에 적어둬.',
  '잘 잤어? 수면 기록 남겨두자. 까먹기 전에!',
  '아침이야! 어제 몇 시에 잤는지 기록해두면 좋겠다.',
];

const SLEEP_REMINDER_NIGHT: readonly string[] = [
  '오늘 수면 기록 아직이야. 내일 아침에 까먹기 전에 지금 남겨두는 게 좋아!',
  '수면 기록 아직 안 했지? 자기 전에 적어두자!',
  '오늘 수면 기록 깜빡한 것 같아. 지금 남겨둘래?',
];

const SLEEP_RECORDED_MORNING: readonly string[] = [
  '수면 기록 미리 해뒀네! 잘했어.',
  '수면 기록 확인했어. 벌써 적어놨구나!',
  '오 수면 기록 이미 남겨놨네. 칭찬해!',
];

const SLEEP_RECORDED_NIGHT: readonly string[] = [
  '오늘 수면 기록 잘 남겨져 있어. 푹 자!',
  '수면 기록 확인했어. 잘 적어뒀네! 오늘도 수고했어.',
  '오늘 수면 기록 잘 들어가 있어. 편하게 쉬어!',
];

/** 수면 리마인더 텍스트 */
export const buildSleepReminderText = (timeOfDay: 'morning' | 'night'): string => {
  const pool = timeOfDay === 'morning' ? SLEEP_REMINDER_MORNING : SLEEP_REMINDER_NIGHT;
  return pick(pool);
};

/** 수면 기록 확인 완료 텍스트 */
export const buildSleepRecordedText = (timeOfDay: 'morning' | 'night' = 'night'): string =>
  pick(timeOfDay === 'morning' ? SLEEP_RECORDED_MORNING : SLEEP_RECORDED_NIGHT);

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

/** 일정 항목 제목 포맷 (메모 제외) */
const formatScheduleTitle = (item: ScheduleRow): string => {
  const isAppointment = item.category === '약속';

  // 기간 일정 표시
  let rangePart = '';
  if (item.date && item.end_date) {
    rangePart = ` ${formatDateShort(item.date)}~${formatDateShort(item.end_date)}`;
  }

  // 중요 표시 (제목 뒤)
  const star = item.important ? ' ★' : '';

  if (isAppointment) return `${item.title}${rangePart}${star}`;
  if (item.status === 'done') return `~${item.title}~${rangePart}${star}`;
  if (item.status === 'in-progress') return `► ${item.title}${rangePart}${star}`;
  return `${item.title}${rangePart}${star}`;
};

/** 메모 텍스트 포맷 (└ 접두어 + 줄바꿈) */
const formatMemoText = (memo: string): string => {
  const lines = memo.split('\n');
  return lines.map((l, i) => (i === 0 ? `└ ${l}` : `  ${l}`)).join('\n');
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

  options.push({
    text: { type: 'plain_text' as const, text: item.important ? '중요 해제' : '중요 표시' },
    value: encodeOverflowValue(item.id, TOGGLE_IMPORTANT_ACTION, targetDate),
  });

  options.push({
    text: { type: 'plain_text' as const, text: '삭제하기' },
    value: encodeOverflowValue(item.id, DELETE_ACTION, targetDate),
  });

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

    const addMemoContext = (memo: string | null): void => {
      if (!memo) return;
      blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: formatMemoText(memo) }],
      });
    };

    const noOverflowLines: { title: string; memo: string | null }[] = [];

    const flushNoOverflow = (): void => {
      if (noOverflowLines.length === 0) return;
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: noOverflowLines.map((l) => l.title).join('\n') },
      });
      // 메모가 있는 항목들의 메모를 context로 추가
      for (const l of noOverflowLines) addMemoContext(l.memo);
      noOverflowLines.length = 0;
    };

    for (const item of group.items) {
      const isAppointment = item.category === '약속';
      const titleText = formatScheduleTitle(item);

      if (isAppointment || !item.status) {
        noOverflowLines.push({ title: titleText, memo: item.memo });
      } else {
        flushNoOverflow();
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: titleText },
          accessory: {
            type: 'overflow',
            action_id: SCHEDULE_ACTION_ID,
            options: buildOverflowOptions(item, targetDate),
          },
        });
        addMemoContext(item.memo);
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

// ─── 일정 텍스트 (크론 알림용 — 블록킷 없이) ────────────

/** 일정 텍스트 메시지 (블록킷 없이 순수 텍스트) */
export const buildScheduleText = (
  items: ScheduleRow[],
  targetDate: string,
  headerOverride?: string,
): string => {
  const formatted = formatDateShort(targetDate);
  const header = headerOverride ?? `${formatted} 일정이야.`;
  const groups = groupByCategory(items);
  const lines: string[] = [header, ''];

  for (const group of groups) {
    lines.push(`[${group.category}]`);
    for (const item of group.items) {
      lines.push(formatScheduleTitle(item));
      if (item.memo) lines.push(formatMemoText(item.memo));
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
};

/** 밤 미완료 일정 텍스트 (없으면 null) */
export const buildNightScheduleText = (
  items: ScheduleRow[],
  targetDate: string,
): string | null => {
  const incomplete = items.filter(
    (s) => s.category !== '약속' && s.status !== 'done' && s.status !== 'cancelled',
  );
  if (incomplete.length === 0) return null;
  return buildScheduleText(incomplete, targetDate, '오늘 아직 못 끝낸 일정이야. 내일로 넘길 건 정리해둬!');
};

// ─── 수면 블록 ──────────────────────────────────────────

/** 분 → "N시간 M분" 포맷 */
const formatDuration = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}시간 ${mins}분` : `${hours}시간`;
};

/** 수면 요약 Block Kit (밤잠 + 낮잠) */
export const buildSleepBlocks = (records: SleepRecordRow[]): KnownBlock[] => {
  if (records.length === 0) {
    return [
      { type: 'section', text: { type: 'mrkdwn', text: '*수면*\n기록 없음' } },
    ];
  }

  const lines = records.map((r) => {
    const label = r.sleep_type === 'night' ? '밤잠' : '낮잠';
    const duration = formatDuration(r.duration_minutes);
    return `${label}  ${r.bedtime} → ${r.wake_time} (${duration})`;
  });

  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*수면*\n${lines.join('\n')}` },
    },
  ];
};
