/**
 * 인사이트 공용 타입과 행동 신호 → 도메인 매핑.
 */

// ─── 타입 ───────────────────────────────────────────────

export type InsightType =
  | 'streak'
  | 'sleepTrend'
  | 'slotGap'
  | 'weekComparison'
  | 'overdueAlert'
  | 'categorySkew'
  | 'drift'
  | 'recovery'
  | 'lapseAlert'
  | 'weeklyRegression'
  | 'spottyPattern';

export type InsightTiming = 'morning' | 'night' | 'weekly';

export type InsightDomain = 'routine' | 'sleep' | 'schedule';

export interface Insight {
  type: InsightType;
  priority: number;
  timing: InsightTiming;
  domain: InsightDomain;
  message: string;
}

/**
 * 행동 신호(InsightType) → source 도메인. 각 detect 함수가 선언하는 `domain` 필드와 일치 —
 * 이 파일이 도메인 진실이다(life_signal 시드 description·data-existence BEHAVIOR_DOMAIN의 오기와 무관).
 * #508 동어반복 필터(ADR-0046)가 발굴에서 "같은 행동 두 번 잼"(시드 도메인==신호 도메인)을 거를 때 source.
 * slotGap·weekComparison은 routine_records 완료율 집계라 routine(시드 이름·옛 description은 schedule처럼 읽히나 오기).
 * Record<InsightType, …>라 11종 누락·오타를 컴파일 타임에 막는다.
 */
export const BEHAVIOR_SIGNAL_DOMAIN: Record<InsightType, InsightDomain> = {
  streak: 'routine',
  sleepTrend: 'sleep',
  slotGap: 'routine',
  weekComparison: 'routine',
  overdueAlert: 'schedule',
  categorySkew: 'schedule',
  drift: 'sleep',
  recovery: 'routine',
  lapseAlert: 'routine',
  weeklyRegression: 'routine',
  spottyPattern: 'routine',
};
