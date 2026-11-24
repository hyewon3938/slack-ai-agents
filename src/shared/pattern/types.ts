/**
 * off-day 대조 검증 엔진의 공용 타입 (pattern-verification에서 분리).
 */

import type { MannWhitneyResult } from '../stats.js';
import type { FdrFamily } from './fdr-family.js';

export type SignalDirection =
  | 'above_avg'
  | 'below_avg'
  | 'above_abs'
  | 'below_abs'
  | 'flag_present';

export type LinkLifecycleStatus =
  | 'active'
  | 'pending'
  | 'weak'
  | 'confirmed'
  | 'rejected'
  | 'archived';

// direction_mismatch(#555): 충분한 표본에서 명확한 역방향(effect ≤ directionMismatchMaxEffect).
// reject(무연관)와 lifecycle은 같이 'rejected'로 종결하되 사유를 분리 — reject=무연관, direction_mismatch=역방향.
export type Verdict = 'confirm' | 'reject' | 'insufficient' | 'inconclusive' | 'direction_mismatch';

/** 신호 일자 시리즈: pass=true / fail=false / 측정불가=null(2×2에서 제외). */
export type DaySeries = Map<string, boolean | null>;

export interface SignalDef {
  id: number;
  name: string;
  kind: 'sql' | 'tag';
  /** signal_defs.source — 'llm'이면 sql 신호 시리즈 계산 시 격리 실행기 사용 (#477 P5b). */
  source: 'seed' | 'llm';
  sqlBody: string | null;
  valueType: 'binary' | 'continuous' | null;
  direction: SignalDirection | null;
  threshold: number | null;
  tagName: string | null;
  windowDays: number | null;
  /** signal_defs.domain — 데이터-존재 윈도우 산출용 (#504, ADR-0044). */
  domain: string | null;
}

export interface Contingency {
  a: number; // 발현 & pass
  b: number; // 발현 & fail
  c: number; // 비발현 & pass
  d: number; // 비발현 & fail
  inconclusive: number; // 발현일인데 신호 측정불가(null)
}

export interface ContingencyVerification {
  p: number;
  effect: number; // rate ratio = (a/(a+b)) / (c/(c+d))
  rateActive: number;
  rateOff: number;
  posteriorAlpha: number;
  posteriorBeta: number;
  posteriorP: number;
  nActive: number;
  nOff: number;
}

export interface LinkVerification {
  linkId: number;
  seedId: number;
  signalId: number;
  seedName: string;
  /** 카드용 자연어 라벨 — seedName 변수명 대체 (#504 P2, ADR-0045). */
  seedLabel: string;
  patternKind: 'saju' | 'life_signal';
  signalName: string;
  /** 카드용 자연어 라벨 — signalName 변수명·깨진 provenance 대체 (#504 P2, ADR-0045). */
  signalLabel: string;
  signalKind: 'sql' | 'tag';
  valueType: 'binary' | 'continuous' | null;
  currentStatus: LinkLifecycleStatus;
  a: number;
  b: number;
  c: number;
  d: number;
  inconclusive: number;
  nActive: number;
  nOff: number;
  rateActive: number;
  rateOff: number;
  effect: number;
  pValue: number; // block permutation p (자기상관 보정, BH-FDR 입력) — P3
  fisherP: number; // Fisher exact p (참고용 → test_detail)
  qValue: number; // bhFdr(blockP)
  mannWhitney: MannWhitneyResult | null; // 연속 신호 보고용 효과크기 (test_detail) — P3
  posteriorAlpha: number;
  posteriorBeta: number;
  posteriorP: number;
  eValue: number; // 누적 e-value sup (P3, ADR-0034). ≥ evalueThreshold → confirmed.
  lastMatchedAt: string | null;
  /** 데이터-존재 + enrollment 클립 합성 윈도우 시작 (관측성 → test_detail.window_start). #523 P0. */
  windowStart: string | null;
  /** BH-FDR 가족 (관측성 → 주간 로그 가족별 m 추적). #523 P0. */
  family: FdrFamily;
  /** 전·후반 효과 부호 일치(표시용, 게이트 아님) → test_detail + 프로필 셀. #523 P1, §2-6. */
  stability: boolean | null;
  verdict: Verdict;
  nextStatus: LinkLifecycleStatus;
}
