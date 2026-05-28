/**
 * behavior_baseline evaluator — 11종 결정론 패턴 (insights.ts detect 함수 위임).
 *
 * insights.ts의 detect 함수가 Insight | null 반환:
 *   null   → 패턴 미발현 → false
 *   Insight → 패턴 발현 → true
 *
 * 마스터 #434 Phase 8까지는 insights.ts(잔소리)와 catalog 시드(매칭)이 동일 SQL을 두 번 실행하는 일시 공존.
 * Phase 8에서 잔소리 시스템을 시드 evaluator로 일원화 (도메인 문서 §17 참조).
 */

import type { BehaviorBaselineAux, BehaviorSignalName, DailyContext } from '../saju-match.js';
import {
  detectCategorySkew,
  detectDrift,
  detectLapseAlert,
  detectOverdue,
  detectRecovery,
  detectSleepTrend,
  detectSlotGap,
  detectSpottyPattern,
  detectStreak,
  detectWeekComparison,
  detectWeeklyRegression,
  type Insight,
} from '../insights.js';

type Detector = (today: string, userId: number) => Promise<Insight | null>;

const BEHAVIOR_MAP: Record<BehaviorSignalName, Detector> = {
  streak: detectStreak,
  sleepTrend: detectSleepTrend,
  slotGap: detectSlotGap,
  weekComparison: detectWeekComparison,
  overdueAlert: detectOverdue,
  // detectCategorySkew는 3번째 인자(timing) 옵셔널 — 기본 'night' 사용
  categorySkew: (today, userId) => detectCategorySkew(today, userId),
  drift: detectDrift,
  recovery: detectRecovery,
  lapseAlert: detectLapseAlert,
  weeklyRegression: detectWeeklyRegression,
  spottyPattern: detectSpottyPattern,
};

export const evaluateBehaviorBaseline = async (
  aux: BehaviorBaselineAux,
  ctx: DailyContext,
): Promise<boolean> => {
  const detector = BEHAVIOR_MAP[aux.signal_name];
  if (!detector) return false;
  const insight = await detector(ctx.date, ctx.userId);
  return insight !== null;
};
