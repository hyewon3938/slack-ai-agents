/**
 * 패턴 발굴 엔진 타입 — 발굴 후보(카드·pending 링크용)와 사전선별 생존 쌍 (#477 P5a, ADR-0039).
 */

import type { MannWhitneyResult } from '../../shared/pattern/stats.js';
import type { FdrFamily } from '../../shared/pattern/fdr-family.js';
import { type Contingency, type ContingencyVerification } from '../../shared/pattern/types.js';
import { type SajuSeedWithMetrics } from '../../shared/pattern/match-types.js';
import type { LoadedSignal } from './hypothesis-discovery-load.js';

/** 발굴 후보 — 여집합 off-day 대조 통과 (surface 전용, pending 링크로 선INSERT). */
export interface DiscoveryCandidate {
  seedId: number;
  signalId: number;
  seedName: string;
  seedDescription: string | null;
  /** 카드용 자연어 라벨 — seedName 변수명 대체 (#504 P2, ADR-0045). */
  seedLabel: string;
  patternKind: 'saju' | 'life_signal';
  signalName: string;
  signalDescription: string | null;
  /** 카드용 자연어 라벨 — signalName 변수명·깨진 provenance 대체 (#504 P2, ADR-0045). */
  signalLabel: string;
  signalKind: 'sql' | 'tag';
  valueType: 'binary' | 'continuous' | null;
  // off-day 통계 (카드 표시 + 감사)
  rateActive: number; // 발현일 pass율
  rateOff: number; // 비발현일 pass율
  effect: number; // rate ratio (이진 효과크기 + 감사; 연속은 effectSize가 1차)
  // 연속 신호 효과크기 (#504, ADR-0044 §4) — 이진화 rate ratio 대신 Mann-Whitney 기반.
  effectSize: number | null; // Hodges-Lehmann 위치이동(raw 단위, Phase 2 카드용). 이진은 null.
  mwP: number | null; // Mann-Whitney p (연속). 이진은 null.
  sortZ: number; // 표준화 z (연속=MW z, 이진=2-proportion z) — top-N 랭킹 키(감사)
  nActive: number;
  hit: number; // cont.a — pending 링크 hit_count
  miss: number; // cont.b — pending 링크 miss_count
  inconclusive: number; // cont.inconclusive
  fisherP: number; // test_detail 참고
  blockP: number; // p_value (자기상관 보정)
  qValue: number; // 가족별 발견 BH-FDR q
  posteriorAlpha: number;
  posteriorBeta: number;
  posteriorP: number; // provisional (EB 없이 hit/miss prior)
  family: FdrFamily;
}
export interface Survivor {
  seed: SajuSeedWithMetrics;
  signal: LoadedSignal;
  cont: Contingency;
  v: ContingencyVerification;
  blockP: number;
  mannWhitney: MannWhitneyResult | null; // 연속 신호만 (효과크기 보고 + 정렬)
  effectSize: number | null; // Hodges-Lehmann 위치이동(연속). 이진은 null.
  sortZ: number; // 표준화 z (연속=방향 MW z, 이진=2-proportion z) — 혼합 top-N 정렬 키
}
