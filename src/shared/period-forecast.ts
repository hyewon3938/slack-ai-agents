/**
 * 예측 장부 — 생성·채점·로드 (#531 / #523 Phase 3, ADR-0050).
 *
 * 상위 주기(월운·세운) 해석을 사전등록 → 사후 채점 장부로 잇는다. 검증 불가 층에
 * 확증편향 차단 규율을 심는 자기검증 메커니즘:
 *   - 시간 구동: 생성·채점 모두 periodFortune 절기/입춘 게이트만으로 무인 작동(수동 트리거 0).
 *   - 멱등: 같은 (user,type,start) 재생성 안 함 → baseline 동결 무결성. 채점은 status='open' 가드.
 *   - self-heal: 채점은 period_end <= today(== 아님) — 놓친 전환을 다음 전환이 자동 회수.
 *   - 동결 = 등록 시 봉인: baseline_rate는 생성 시점 캡처, 채점이 절대 재계산 안 함(사다리 Decision 3).
 *
 * 검증가능성 사다리(ADR-0050): wolun/seun만(대운 비편입 — 채점 주기가 수명 초과 = 비실증 층).
 * Brier 등 확률점수 금지 — 표본 없는 층에서 확률 산출은 과대주장. 방향 적중 + 실측 delta만.
 *
 * 순수 도출(랭킹·대표선택·방향·집계)은 결정론, DB I/O는 격리. period-interpretation은
 * LedgerCardData를 type-only import(런타임 순환 0) — 이 파일은 순수 데이터만 산출.
 */

export type {
  LedgerPeriodType,
  ForecastSourceCell,
  NoCallReason,
  ForecastEntry,
  ScoredEntry,
  LedgerCardData,
  ForecastRange,
} from './period/types.js';
export { generateForecasts } from './period/forecast-generate.js';
export { scoreForecasts } from './period/forecast-score.js';
export { loadLedger } from './period/forecast-ledger.js';
