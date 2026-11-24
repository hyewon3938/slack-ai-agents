/**
 * 사주 시드 카탈로그 기반 일일 매칭 엔진.
 * ADR-0017 + ADR-0026(pattern_* rename) + ADR-0033(매트릭=가설 5어휘 재정의, #477 P1) 참조.
 *
 * 흐름:
 *   1) loadActiveSeeds — pattern_catalog + pattern_links × signal_defs(전역 신호) 조회
 *   2) getDailyContext — 일운(getDayPillar) + 본명(saju_profiles) 로드
 *   3) evaluateTrigger — trigger_target_type별 분기 평가
 *   4) evaluateMetric — 신호 평가: kind=sql(SQL + baseline/임계 비교) | kind=tag(그날 태그 존재 여부)
 *   5) recordDailyMatches — seed_daily_activations UPSERT (오늘 발현 시드 핸드오프 로그)
 *
 * #477 P2: 검증 단위는 (시드 × 신호) = pattern_links, 검증은 주간 엔진(pattern-verification)이
 * raw에서 윈도우 재계산. 본 모듈은 매칭 + 일별 핸드오프 기록(seed_daily_activations)까지만 담당.
 */

// 구현은 ./pattern/ 아래 역할별 파일에 있다. 이 파일은 기존 import 경로를 유지하는 재수출 전용이다.

export type {
  PillarLevel,
  SajuSeed,
  SajuMetric,
  SajuSeedWithMetrics,
  NatalContext,
  DailyContext,
  MetricEvaluation,
  SeedMatchResult,
} from './pattern/match-types.js';
export {
  type WeekdayDow,
  type WeekdayAux,
  type WeekdayGroupAux,
  type MonthPositionAux,
  type SeasonAux,
  type CalendarEventAux,
  type ThresholdAux,
  type BehaviorSignalName,
  type BehaviorBaselineAux,
  type LifeSignalAux,
  isLifeSignalAux,
} from './pattern/match-aux-types.js';
export { loadNatalContext, getDailyContext } from './pattern/match-context.js';
export { loadActiveSeeds } from './pattern/match-seeds.js';
export { __resetCacheForTest } from './pattern/match-trigger-lookups.js';
export { evaluateTrigger } from './pattern/match-trigger.js';
export {
  type MetricRunner,
  runMetricSql,
  runLlmSignalSql,
  runnerForSource,
  evaluateMetric,
} from './pattern/match-metric.js';
export {
  buildNameIdMap,
  loadStrengthCutpoints,
  matchAllSeedsForDay,
  recordDailyMatches,
} from './pattern/match-day.js';
