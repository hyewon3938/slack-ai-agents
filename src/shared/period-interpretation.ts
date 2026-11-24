/**
 * 기간 해석 엔진 — 월운/세운/대운 (#529 / #523 Phase 2, ADR-0050).
 *
 * 일운 집계 레이어(saju_response_profile)를 상위 주기 해석으로 잇는다:
 *   결정론 도출(기간 pillar → 십성·오행·합충)
 *     → 개인화 프로필 조인 payload { measuredCells, textbookCells, descriptiveStats }
 *     → LLM 서사(측정/교과서 분리 발화 + 전이 가설 hedge)
 *     → 결정론 렌더(cron·fast path 공용).
 *
 * 검증가능성 사다리(ADR-0050): 월운=축적-실증 / 세운=장부한정 약실증 / 대운=비실증 추론.
 *   단위가 커질수록 표본이 줄어 통계 확정 가능성이 떨어진다 → 각 층의 지위를 라벨로 동반한다.
 * 전이 가설(일 단위 십성·오행 반응이 상위 단위에 같은 방향으로 보존된다)은 미검증 가정 —
 *   모든 상위 단위 출력에 hedge로 따라다닌다(통계 주장 금지).
 * 결정론 얕게/해석 깊게(ADR-0038): 글자·십성·합충 도출은 코드가, 서사는 LLM이.
 *   LLM에는 구조화 payload만 주고 측정 셀과 교과서 셀을 분리 발화시킨다.
 * 출력 연속성(D8): measuredCells=0이어도 카드는 항상 발송 — 교과서 + 누적 기술통계로 채운다.
 *   침묵 금지, 단 무증거를 증거처럼 말하기도 금지.
 */

export type {
  PeriodType,
  ResponseProfileIndex,
  PeriodContext,
  MeasuredCell,
  TextbookCell,
  DescriptiveStats,
  InterpretationPayload,
  PeriodInterpretationRecord,
} from './period/types.js';
export { derivePeriodContext } from './period/interpretation-derive.js';
export { PERIOD_LABEL } from './period/interpretation-labels.js';
export { buildInterpretationPayload } from './period/interpretation-payload.js';
export { composeNarrative } from './period/interpretation-narrative.js';
export { renderInterpretationBlocks } from './period/interpretation-render.js';
export {
  loadResponseProfileIndex,
  upsertInterpretation,
  loadLatestInterpretation,
} from './period/interpretation-store.js';
