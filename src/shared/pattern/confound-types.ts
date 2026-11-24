/**
 * 교란 플래그·조정 타입 (confound에서 분리).
 */
// ─── 타입 ────────────────────────────────────────────────

/** 교란 의심 후보 — 링크 시드 S와 공동발현 + 신호 X와도 연관된 제3시드 Z. */
export interface SuspectedConfounder {
  seedId: number;
  seedName: string;
  overlap: number; // P(Z active | S active)
  effectZX: number; // Z↔X rate ratio (발현일 pass율 / 비발현일 pass율)
  nCofire: number; // |actS ∩ actZ| 공동발현일 수 (P7 데이터 게이트 입력)
}

/** 한 링크의 교란 조정 판정 — Z 통제 후 연관이 어떻게 됐는지(P7, ADR-0042). */
export type ConfoundVerdict = 'survives' | 'attenuated' | 'explained_away';

/**
 * 게이트 통과 교란별 MH 조정 결과(P7). joint면 기여 Z마다 같은 adjEffect/verdict 공유(대표 1),
 * fallback이면 단일 Z. 카드·뷰는 explainedAway 플래그 + seedId(이름은 suspected에서 join).
 */
export interface AdjustedConfounder {
  seedId: number;
  adjEffect: number; // MH 조정 rate ratio
  nCofire: number;
  verdict: ConfoundVerdict;
}

/** confound JSONB 형태 — "점검했다"는 사실(scannedAt) + 의심 목록(P6) + 조정 결과(P7, 게이트 통과 시만). */
export interface ConfoundData {
  scannedAt: string;
  suspected: SuspectedConfounder[];
  adjusted?: AdjustedConfounder[]; // P7 — 게이트(nCofire≥adjustMinCofire) 통과 시만(미달이면 키 없음)
  explainedAway?: boolean; // P7 — 링크 verdict가 explained_away면 true(뷰 verified 가드가 읽음)
}

export interface ConfoundResult {
  linkId: number;
  confound: ConfoundData;
}

/** 교란 플래그 임계 (P6, insight-thresholds.confound). 파라미터로 받아 테스트가 커스텀 주입 가능. */
export interface ConfoundThresholds {
  minOverlap: number;
  minCofireDays: number;
  minEffectZX: number;
  topN: number;
}

/** 교란 조정 임계 (P7). insight-thresholds.confound가 두 인터페이스를 모두 구조적으로 만족. */
export interface ConfoundAdjustThresholds {
  adjustMinCofire: number; // 공동발현일 게이트(이상이면 조정)
  explainAwayMaxEffect: number; // 조정 후 이 미만이면 explained_away
  attenuatedMaxRatio: number; // explainAway~marginal·이 값 사이면 attenuated
  minStratumCell: number; // joint 층 viability 최소 셀
}

/** 교란 후보 = active 시드 + 미리 계산된 활성 시리즈. */
export interface ConfoundCandidate {
  seedId: number;
  seedName: string;
  act: Map<string, boolean>;
}
