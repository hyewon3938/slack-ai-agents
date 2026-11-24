/**
 * 프로액티브 인사이트 감지 엔진.
 * 수면/루틴/일정 데이터에서 의미 있는 패턴을 감지하고 넛지 메시지를 생성한다.
 * Pure SQL + 코드 템플릿 기반 (LLM 호출 없음, 비용 0).
 */

export type { InsightType, InsightTiming, InsightDomain, Insight } from './insights/types.js';
export { BEHAVIOR_SIGNAL_DOMAIN } from './insights/types.js';
export { detectStreak, detectRecovery, detectLapseAlert } from './insights/routine-streak.js';
export { detectSlotGap, detectWeekComparison } from './insights/routine-comparison.js';
export { detectWeeklyRegression, detectSpottyPattern } from './insights/routine-decline.js';
export { detectSleepTrend, detectDrift } from './insights/sleep.js';
export { detectOverdue, detectCategorySkew } from './insights/schedule.js';
export { pickMorningNudges, pickNightNudges, pickWeeklyInsights } from './insights/pick.js';
