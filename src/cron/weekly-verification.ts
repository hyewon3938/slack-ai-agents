/**
 * 주간 off-day 검증 엔진 cron — 월요일 06:00 KST (#477 P2·P3).
 * weekly-hypothesis-review를 대체. ADR-0032(통계 스택)·0033(매트릭=가설)·0034(e-value)·0035(노출).
 *
 * 흐름:
 *   1) active pattern_links 전부 off-day 대조 재계산 (verifyUserLinks — raw 윈도우 재계산 + e-value)
 *   2) 링크별 pattern_links UPDATE (counters + p/q/effect/posterior/e_value/test_detail + status 전이)
 *   3) 링크별 주간 스냅샷 link_weekly_stats write (마틴게일 trail·emerging 진행바·주간대비)
 *   4) 교란 플래그 · 포화 가드 · 발굴 후보 · 개인화 프로파일 집계 (전부 DB write)
 *
 * #542(ADR-0052): 사용자-facing 검증 현황 카드는 발송 은퇴 — routine(weekly-saju-review-v2)
 * 통합 카드가 검증 현황을 흡수해 단독 발송한다. 이 엔진은 카드 생성 없이 DB만 갱신(검증·발굴 그대로).
 * weeklyReviewFallbackTask(월 10:00)가 routine 미발송 주에 "수동 실행" 알림만 발송(출력 연속성).
 *
 * P3: 확정 게이트 = e_value ≥ 1/α(=20) → status='confirmed'(verified tier). reject만 추가로 DB 반영.
 * confirmed는 sticky(verifyUserLinks가 active만 재검증). 등급 노출은 saju_influence_summary(080).
 */

export { previousMondayISO } from './weekly-verification/week-start.js';
export { persistLinkVerification } from './weekly-verification/persist-links.js';
export { weeklyVerificationTask, weeklyReviewFallbackTask } from './weekly-verification/tasks.js';
