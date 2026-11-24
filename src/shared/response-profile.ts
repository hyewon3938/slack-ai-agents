/**
 * 개인화 가중치 집계 레이어: saju_response_profile (#523 Phase 1, #408 5-B 구체화, ADR-0049).
 *
 * 검증된(confirmed)·검증중(active) pattern_links를 사주 축으로 집계해 "이 사람은 [십성/오행]에
 * 어떻게 반응하는가"의 셀 프로필을 만든다. Phase 2(기간 해석)·Phase 3(예측 장부)가 이 프로필을
 * 기간 pillar(월운/세운/대운)에 조인한다.
 *
 * 이중계산 구조적 차단(D4):
 *   - 원천 기여 = 링크당 정확히 1 source 셀 (stem→천간글자, branch→지지글자, hwa_sipsung→그룹, strength_band 강→오행밴드).
 *   - 글자 source는 결정론 롤업 → 십성 → 십성그룹(α/β·nActive 합산). 어떤 조회도 두 레벨을 합산하지 않음(resolveCell).
 *   - 천간 글자와 지지 글자는 별도 축(char_stem/char_branch) — 한글 동음이의(천간 辛 vs 지지 申='신')가 다른 십성으로
 *     가므로 한 셀로 병합하면 안 됨. axis_key는 깨끗한 글자 유지.
 *   - 오행은 그룹 셀의 별칭(일간 고정 시 십성그룹 5 = 오행 5 동형) — 별도 레벨 저장 안 함.
 *   - element_band(강 밴드만)는 별도 축 — 기간 pillar 오행에 직접 조인(생극 간접추론 배제).
 *
 * winner's curse 차단(D3): 효과 = shrunk(posterior_p/rate_off), explained_away 제외, attenuated는 min.
 * 순수 함수(DB·시각 의존 0) → 결정론·단위 테스트 용이. DB I/O·full-replace는 weekly-verification.ts.
 */

export type {
  AxisLevel,
  CellTier,
  SeedForCell,
  PrimaryCell,
  ResponseCell,
} from './response-profile/axis.js';
export { groupElement, mapSeedToCell, cellKey } from './response-profile/axis.js';
export type { ProfileLink } from './response-profile/aggregate.js';
export { buildResponseProfile } from './response-profile/aggregate.js';
export type { ResolvedCell } from './response-profile/resolve.js';
export {
  indexCells,
  resolveHierarchyCell,
  resolveElementBandCell,
} from './response-profile/resolve.js';
