/**
 * 교란 플래그 + 다변량 분리 엔진 — 공동발현 시드 (#477 P6 ADR-0041, P7 ADR-0042).
 *
 * off-day 검증(P2)은 단일 시드의 **marginal 연관**만 본다. 같은 날 공존하는 제3변수(달력 주기 =
 * 요일·주말·월위치·계절, 또는 다른 사주 시드)가 시드와 신호 둘 다를 끌면 가짜 연관(교란·"어부지리").
 * P6는 claimable(활성·확정) (시드 S × 신호 X) 링크마다 공동발현 교란 시드 Z를 탐지·플래그한다(marginal).
 * P7은 공동발현이 충분히 쌓인(nCofire ≥ 게이트) 쌍만 **Mantel-Haenszel 층화**로 조정 추정치를 산출해
 * 어부지리를 노출에서 실제로 걷어낸다(explained_away → 노출 레이어 soft-demote).
 *
 * 핵심(헌장 ④): 교란변수가 이미 결정론 시드(life_signal 18 + 사주)라 feature 환원이 끝나 있음 →
 * 기존 시드 활성 시리즈 + 기존 2×2(buildContingency/verifyContingency) 재사용. 새 통계 코어는 MH 풀링 하나.
 *
 * P7 데이터 게이트(dormant): nCofire < adjustMinCofire면 조정 안 함 → confound.adjusted 미기록 →
 * 뷰 무변화(배포 시 동작 변화 0). 공동발현 누적 시 다음 주간 run이 자동 조정.
 * e-value·status 불변(ADR-0034 결정론) — 조정은 노출 레이어에서만(ADR-0042 §3).
 * 본 모듈은 순수 계산 + 읽기만. UPDATE pattern_links.confound·카드 발송은 weekly-verification.ts.
 */

// 구현은 ./pattern/ 아래 역할별 파일에 있다. 이 파일은 기존 import 경로를 유지하는 재수출 전용이다.

export type {
  SuspectedConfounder,
  ConfoundVerdict,
  AdjustedConfounder,
  ConfoundData,
  ConfoundResult,
  ConfoundThresholds,
  ConfoundAdjustThresholds,
  ConfoundCandidate,
} from './pattern/confound-types.js';
export {
  computeOverlap,
  flagConfoundersForLink,
  buildStrata,
  classifyVerdict,
  type AdjustInput,
  adjustConfounders,
} from './pattern/confound-calc.js';
export { flagConfounds } from './pattern/confound-flag.js';
