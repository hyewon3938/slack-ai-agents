import type { KnownBlock } from '@slack/types';
import type { RoutineRecord } from '../../shared/routine-notion.js';
import { frequencyBadge } from '../../shared/routine-notion.js';

const ACTION_ID = 'routine_complete';

const TIME_SLOT_ORDER = ['아침', '점심', '저녁', '밤'] as const;

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** "YYYY-MM-DD" → "3/7(토)" */
export const formatDateShort = (dateStr: string): string => {
  const d = new Date(dateStr + 'T00:00:00+09:00');
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const dayName = DAY_NAMES[d.getDay()];
  return `${month}/${day}(${dayName})`;
};

/** 루틴 체크리스트 Block Kit 메시지 빌드 */
export const buildRoutineBlocks = (
  records: RoutineRecord[],
  today: string,
): { text: string; blocks: KnownBlock[] } => {
  const blocks: KnownBlock[] = [];
  const todayFormatted = formatDateShort(today);

  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: `${todayFormatted} 루틴 체크`, emoji: true },
  });

  for (const slot of TIME_SLOT_ORDER) {
    const slotRecords = records.filter((r) => r.timeSlot === slot);
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
          text: { type: 'mrkdwn', text: `~${record.title}~${suffix} :white_check_mark:` },
        });
      } else {
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: `${record.title}${suffix}` },
          accessory: {
            type: 'button',
            text: { type: 'plain_text', text: '완료 ✓', emoji: true },
            action_id: ACTION_ID,
            value: record.id,
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

/** 시간대 필터링된 체크리스트 빌드 (크론 알림용) */
export const buildFilteredRoutineBlocks = (
  records: RoutineRecord[],
  today: string,
  targetSlots: readonly string[],
  includeIncompleteFrom?: readonly string[],
): { text: string; blocks: KnownBlock[] } => {
  const filtered = records.filter((r) => {
    if (targetSlots.includes(r.timeSlot)) return true;
    if (includeIncompleteFrom?.includes(r.timeSlot) && !r.completed) return true;
    return false;
  });

  return buildRoutineBlocks(filtered, today);
};

// ---------- 메시지 변형 ----------

const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]!;

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
    '아침 달성률이 낮아. 아침 루틴 점검해봐.',
  ],
  '점심': [
    '점심 루틴을 자주 놓쳤네. 점심 시간 좀 신경 써.',
    '점심 쪽이 약해. 점심 루틴 챙기는 게 우선이야.',
    '점심 달성률이 낮아. 점심 시간 활용해 보자.',
  ],
  '저녁': [
    '저녁 루틴을 많이 놓쳤네. 저녁에 여유 좀 가져.',
    '저녁 쪽이 취약해. 저녁 루틴 다시 챙겨봐.',
    '저녁 달성률이 낮아. 저녁 루틴 점검해 보자.',
  ],
  '밤': [
    '밤 루틴을 자주 빠뜨렸네. 자기 전에 체크하는 습관 들여.',
    '밤 쪽이 약해. 자기 전 루틴 챙겨.',
    '밤 달성률이 낮아. 자기 전에 확인하는 거 잊지 마.',
  ],
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

/** 어제 기록 중 달성률이 가장 낮은 시간대 분석 */
const buildSlotAnalysis = (records: RoutineRecord[]): string | null => {
  const slotStats = TIME_SLOT_ORDER.map((slot) => {
    const slotRecords = records.filter((r) => r.timeSlot === slot);
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

/** 아침 인사 블록 빌드 (어제 완료율 + 시간대 분석 포함) */
export const buildMorningGreetingBlocks = (
  yesterdayRecords: RoutineRecord[],
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

/** 밤 요약 메시지 빌드 */
export const buildNightSummaryBlocks = (
  records: RoutineRecord[],
  today: string,
): { text: string; blocks: KnownBlock[] } => {
  const result = buildRoutineBlocks(records, today);
  const total = records.length;
  const completed = records.filter((r) => r.completed).length;

  const summaryText =
    total === completed
      ? pick(NIGHT_COMPLETE)
      : pick(NIGHT_INCOMPLETE)(completed, total);

  result.blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: `\n${summaryText}` },
  });

  return result;
};
