/**
 * 일일 매칭 엔진의 공용 타입 (pattern-match에서 분리).
 */

import type { Cheongan, Jiji, Pillar } from '../saju-calendar.js';

export type PillarLevel = 'wonguk' | 'daeun' | 'seun' | 'wolun' | 'ilun';

export interface SajuSeed {
  id: number;
  user_id: number;
  name: string;
  sipsin: string | null;
  description: string | null;
  trigger_target_type:
    | 'stem'
    | 'branch'
    | 'ganji'
    | 'element_density'
    | 'sibiunsung'
    | 'relation'
    | 'strength_band'
    | 'hwa_sipsung'
    | 'life_signal';
  trigger_target_id: number | null;
  trigger_aux: Record<string, unknown> | null;
  /** 사주 시드 발현 운 레벨. life_signal/null은 미적용 (마스터 #434 Phase 2.5). */
  pillar_level: PillarLevel | null;
  active: boolean;
  source: 'seed' | 'llm_promoted';
}

/**
 * (시드 × 신호) 평가 단위. #477 P1: pattern_links × signal_defs JOIN 결과.
 * kind=sql이면 expected_metric_sql/expected_direction 보유(CHECK 보장),
 * kind=tag이면 tag_name 보유 + 그날 태그 존재 여부를 binary로 평가.
 */
export interface SajuMetric {
  link_id: number;
  signal_id: number;
  pattern_id: number;
  metric_name: string;
  kind: 'sql' | 'tag';
  /** signal_defs.source — 'llm'이면 실행 시 untrusted SQL 격리 경로(runLlmSignalSql) 사용 (#477 P5b). */
  source: 'seed' | 'llm';
  expected_metric_sql: string | null;
  expected_direction: 'above_avg' | 'below_avg' | 'above_abs' | 'below_abs' | 'flag_present' | null;
  expected_threshold: number | null;
  value_type: 'binary' | 'continuous' | null;
  tag_name: string | null;
  domain:
    | 'schedule'
    | 'routine'
    | 'sleep'
    | 'expense'
    | 'diary_meta'
    | 'audit'
    | 'expense_category_present';
}

export interface SajuSeedWithMetrics extends SajuSeed {
  metrics: SajuMetric[];
}

export interface NatalContext {
  stems: Cheongan[];
  branches: Jiji[];
  dayMaster: Cheongan;
  /** 원국 4주 (year/month/day/hour 순) — Phase 2.5 cumulative trigger용 */
  pillars: Pillar[];
  /** 생년월일 (YYYY-MM-DD) — 대운 추출용. 미등록 시 null */
  birthDate: string | null;
  /** saju_profiles.daewun_list — 대운 추출용 */
  daewunList: ReadonlyArray<{ age: number; pillar: string }>;
}

export interface DailyContext {
  date: string;
  /** 평가 대상 사용자 ID. life_signal threshold/behavior_baseline evaluator가 본인 데이터 SELECT 시 사용 (마스터 #434 Phase 3). */
  userId: number;
  dayStem: Cheongan;
  dayBranch: Jiji;
  natal: NatalContext;
  /** 일운 Pillar (= {cheongan: dayStem, jiji: dayBranch}) — Phase 2.5 */
  ilun: Pillar;
  /** 월운 Pillar — Phase 2.5 */
  wolun: Pillar;
  /** 세운 Pillar (= year pillar of target date) — Phase 2.5 */
  seun: Pillar;
  /** 대운 Pillar (적용 구간 외 또는 미등록 시 null) — Phase 2.5 */
  daeun: Pillar | null;
}

export interface MetricEvaluation {
  metric_name: string;
  domain: string;
  todayValue: number;
  baselineAvg: number | null;
  threshold: number | null;
  direction: string;
  passed: boolean;
}

export interface SeedMatchResult {
  seed: SajuSeedWithMetrics;
  triggerActivated: boolean;
  metricEvaluations: MetricEvaluation[];
  /** 매트릭 평가 결과. 매트릭 없는 풀셋 시드(evidence-only)는 null. */
  matched: boolean | null;
  /** 풀셋 evidence-only 시드 여부(매트릭 없음). matched=null로 기록. */
  isEvidenceOnly: boolean;
  /** 시드 평가 중 SQL/시스템 오류 발생 시 message. 로깅용(일별 핸드오프 로그엔 미기록). */
  triggerError: string | null;
}
