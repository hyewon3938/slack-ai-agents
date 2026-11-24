/** 기간 해석·예측 장부 공용 타입 — 해석 쪽과 예측 쪽이 서로의 타입을 여기서 가져온다. */

import type { Cheongan, Jiji, Element, Sipsung, Pillar, Relations } from '../saju/types.js';
import type { AxisLevel, CellTier, ResponseCell } from '../response-profile/axis.js';

export type PeriodType = 'wolun' | 'seun' | 'daeun';

/** resolveCell 인덱스 — saju_response_profile 행을 (레벨|키|도메인) 키로. (response-profile ResponseCell 재사용) */
export type ResponseProfileIndex = ReadonlyMap<string, ResponseCell>;

export interface PeriodContext {
  periodType: PeriodType;
  pillar: Pillar;
  stem: Cheongan;
  branch: Jiji;
  stemElement: Element;
  branchElement: Element;
  stemSipsung: Sipsung;
  branchSipsung: Sipsung;
  relations: Relations;
}

/** 측정 셀 — 전수가 profileIndex(saju_response_profile) 행 출신(불변식). */
export interface MeasuredCell {
  domain: string;
  via: 'stem' | 'branch' | 'stem-element' | 'branch-element';
  resolvedLevel: AxisLevel;
  axisKey: string;
  element: Element | null;
  tier: CellTier;
  shrunkEffect: number | null;
  nActiveDays: number;
  /** 셀 기여 링크 ids(ResponseCell 승계) — Phase 3 예측 장부가 대표 신호 해소에 사용(#531). */
  sourceLinkIds: number[];
}

/** 교과서 일반론 후보(라벨 = 미검증) — 측정 증거 없는 십성·관계에서 결정론 도출. */
export interface TextbookCell {
  axis: 'stem-sipsung' | 'branch-sipsung' | 'relation';
  label: string; // 십성명 또는 관계 문자열
  gloss: string; // 교과서 한 줄
}

/** 누적 기술통계 — wolun=과거 동일 월지 절기월들, seun/daeun=기간 시작~현재. */
export interface DescriptiveStats {
  scope: string; // 사람이 읽는 범위 설명
  rangeCount: number; // 집계한 구간 수
  sleep: { avgDuration: number; recordCount: number } | null;
  routine: { rate: number; total: number } | null;
  diary: { count: number } | null;
}

export interface InterpretationPayload {
  measuredCells: MeasuredCell[];
  textbookCells: TextbookCell[];
  descriptiveStats: DescriptiveStats;
}

/** 영속·렌더 공용 레코드 — period_interpretations 1행에 대응. */
export interface PeriodInterpretationRecord {
  periodType: PeriodType;
  pillar: string; // 한글 2자
  periodStart: string;
  periodEnd: string | null;
  payload: InterpretationPayload;
  narrative: string;
}

/** 장부 편입 주기 — wolun/seun만(대운 비편입). */
export type LedgerPeriodType = 'wolun' | 'seun';

/** 근거 셀 provenance — 예측 행이 어느 측정 셀·대표 신호에서 나왔는지(채점은 안 읽음, 카드·감사용). */
export type ForecastSourceCell = Omit<MeasuredCell, 'sourceLinkIds'> & { signalId: number };

/** no_call 사유 — 예측할 측정 셀이 없었음(D8: '예측 안 함'도 정보). */
export interface NoCallReason {
  reason: string;
}

/** 생성/로드 결과 1행 (open 예측 또는 no_call). */
export interface ForecastEntry {
  signalId: number | null;
  status: 'open' | 'no_call';
  predictedDirection: 'up' | 'down' | null;
  baselineRate: number | null;
  sourceCell: ForecastSourceCell | NoCallReason;
}

/** 채점 결과 1행. */
export interface ScoredEntry {
  signalId: number | null;
  status: 'scored' | 'unmeasurable';
  predictedDirection: 'up' | 'down' | null;
  baselineRate: number | null;
  measuredRate: number | null;
  measuredDelta: number | null;
  directionHit: boolean | null;
  sourceCell: ForecastSourceCell | NoCallReason; // 저장 행의 source_cell이 비거나 손상되면 사유
}

/** 카드 렌더 입력(순수 데이터) — period-interpretation이 type-only import. */
export interface LedgerCardData {
  periodType: LedgerPeriodType;
  scored: ScoredEntry[]; // 지난 기간 채점 결과
  forecasts: ForecastEntry[]; // 이번 기간 예측(open + no_call)
}

export interface ForecastRange {
  start: string;
  end: string;
}
