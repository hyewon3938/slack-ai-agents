/**
 * 통합 감지 실행과 타이밍별 넛지 선택 (크론 진입 함수).
 */

import { INSIGHT_THRESHOLDS } from '../insight-thresholds.js';
import { detectSlotGap, detectWeekComparison } from './routine-comparison.js';
import { detectWeeklyRegression, detectSpottyPattern } from './routine-decline.js';
import { detectStreak, detectRecovery, detectLapseAlert } from './routine-streak.js';
import { detectOverdue, detectCategorySkew } from './schedule.js';
import { detectSleepTrend, detectDrift } from './sleep.js';
import type { InsightTiming, InsightDomain, Insight } from './types.js';

// ─── 통합 감지 + 넛지 선택 ──────────────────────────────

const detectAllForTiming = async (
  today: string,
  userId: number,
  timing: InsightTiming,
): Promise<Insight[]> => {
  const morning = timing === 'morning';
  const weekly = timing === 'weekly';

  const tasks: Array<Promise<Insight | null>> = [
    detectStreak(today, userId),
    detectSleepTrend(today, userId),
    detectSlotGap(today, userId),
    detectWeekComparison(today, userId),
    detectOverdue(today, userId),
  ];

  if (!morning) tasks.push(detectCategorySkew(today, userId, weekly ? 'weekly' : 'night'));
  if (weekly) tasks.push(detectDrift(today, userId));
  if (morning) tasks.push(detectRecovery(today, userId));
  if (!morning && !weekly) tasks.push(detectLapseAlert(today, userId));
  if (weekly) tasks.push(detectWeeklyRegression(today, userId));
  if (!morning && !weekly) tasks.push(detectSpottyPattern(today, userId));

  const results = await Promise.all(tasks);
  return results.filter((r): r is Insight => r !== null && r.timing === timing);
};

const pickByTiming = async (
  today: string,
  userId: number,
  timing: InsightTiming,
): Promise<Insight[]> => {
  const { minPriority, maxItems } = INSIGHT_THRESHOLDS.pickByTiming;
  const all = await detectAllForTiming(today, userId, timing);

  const filtered = all.filter((i) => i.priority >= minPriority);
  filtered.sort((a, b) => b.priority - a.priority);

  const seen = new Set<InsightDomain>();
  const deduped: Insight[] = [];
  for (const insight of filtered) {
    if (seen.has(insight.domain)) continue;
    seen.add(insight.domain);
    deduped.push(insight);
    if (deduped.length >= maxItems) break;
  }

  return deduped;
};

/** 아침 크론용: priority ≥5인 morning 인사이트, 같은 도메인 dedupe, 최대 3개 */
export const pickMorningNudges = (today: string, userId: number): Promise<Insight[]> =>
  pickByTiming(today, userId, 'morning');

/** 밤 크론용: priority ≥5인 night 인사이트, 같은 도메인 dedupe, 최대 3개 */
export const pickNightNudges = (today: string, userId: number): Promise<Insight[]> =>
  pickByTiming(today, userId, 'night');

/** 주간 리포트용: weekly 인사이트 (도메인 dedupe + cap 동일) */
export const pickWeeklyInsights = (today: string, userId: number): Promise<Insight[]> =>
  pickByTiming(today, userId, 'weekly');

// #477 P1: confirmed 가설 일일 라인(pickConfirmedHypothesisLines)은 pattern_hypotheses/pattern_stats
// DROP과 함께 제거. P2 주간 검증 엔진이 pattern_links(status='confirmed') 기반으로 복원 예정.
