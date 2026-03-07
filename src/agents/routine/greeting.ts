import type { LLMClient } from '../../shared/llm.js';
import type { RoutineRecord } from '../../shared/routine-notion.js';
import { generateGreeting } from '../../shared/cron-greeting.js';

const TIME_SLOT_ORDER = ['아침', '점심', '저녁', '밤'] as const;

interface SlotStat {
  slot: string;
  total: number;
  completed: number;
  pct: number;
}

const buildSlotStats = (records: RoutineRecord[]): SlotStat[] => {
  const result: SlotStat[] = [];
  for (const slot of TIME_SLOT_ORDER) {
    const slotRecords = records.filter((r) => r.timeSlot === slot);
    if (slotRecords.length === 0) continue;
    const completed = slotRecords.filter((r) => r.completed).length;
    result.push({
      slot,
      total: slotRecords.length,
      completed,
      pct: Math.round((completed / slotRecords.length) * 100),
    });
  }
  return result;
};

const findWeakestSlot = (slotStats: SlotStat[]): SlotStat | null => {
  if (slotStats.length < 2) return null;
  const worst = slotStats.reduce((w, c) => (c.pct < w.pct ? c : w));
  return worst.pct < 70 ? worst : null;
};

/** 아침 인사 메시지 생성 (어제 완료율 기반) */
export const generateMorningGreeting = async (
  llmClient: LLMClient,
  yesterdayRecords: RoutineRecord[],
): Promise<string> => {
  if (yesterdayRecords.length === 0) {
    return generateGreeting(
      llmClient,
      '어제 루틴 기록이 하나도 없어. 걱정하면서 오늘 다시 시작하자는 톤으로 한 문장만.',
      '어제 기록이 없네. 오늘은 하나씩 챙기자.',
    );
  }

  const total = yesterdayRecords.length;
  const completed = yesterdayRecords.filter((r) => r.completed).length;
  const pct = Math.round((completed / total) * 100);
  const slotStats = buildSlotStats(yesterdayRecords);
  const statsText = slotStats
    .map((s) => `${s.slot}: ${s.completed}/${s.total}(${s.pct}%)`)
    .join(', ');

  let prompt: string;
  if (pct === 100) {
    prompt = `어제 루틴 ${pct}% 전부 완료 (${completed}/${total}). 시간대별: ${statsText}. 칭찬하면서 오늘도 이대로 가자는 톤으로 한두 문장만.`;
  } else if (pct >= 70) {
    prompt = `어제 루틴 ${pct}% (${completed}/${total}). 시간대별: ${statsText}. 거의 다 했다고 인정하면서 빠진 거 신경 쓰라는 톤으로 한두 문장만.`;
  } else {
    prompt = `어제 루틴 ${pct}% (${completed}/${total}). 시간대별: ${statsText}. 걱정하면서 오늘은 챙기자는 톤으로 한두 문장만.`;
  }

  const weakest = findWeakestSlot(slotStats);
  if (weakest) {
    prompt += ` 특히 ${weakest.slot} 시간대(${weakest.pct}%)가 약하니까 그것도 언급해.`;
  }

  return generateGreeting(llmClient, prompt, `어제 루틴 ${pct}%. 오늘도 챙기자.`);
};

/** 밤 마무리 메시지 생성 (오늘 완료율 기반) */
export const generateNightSummary = async (
  llmClient: LLMClient,
  records: RoutineRecord[],
): Promise<string> => {
  const total = records.length;
  const completed = records.filter((r) => r.completed).length;

  let prompt: string;
  let fallback: string;

  if (completed === total) {
    prompt = `오늘 루틴 ${total}개 전부 완료. 수고했다, 푹 쉬라는 톤으로 한 문장만.`;
    fallback = '오늘 루틴 전부 완료. 수고했어, 푹 쉬어.';
  } else {
    const incomplete = records
      .filter((r) => !r.completed)
      .map((r) => r.title);
    const pct = Math.round((completed / total) * 100);
    prompt = `오늘 루틴 ${completed}/${total} 완료 (${pct}%). 못 한 것: ${incomplete.join(', ')}. 아쉽지만 내일 하자는 톤으로 한두 문장만.`;
    fallback = `오늘 루틴 ${completed}/${total} 완료. 남은 건 내일 챙기자.`;
  }

  return generateGreeting(llmClient, prompt, fallback);
};
