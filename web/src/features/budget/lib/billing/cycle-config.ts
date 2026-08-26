/**
 * 결제주기 시작일 — 이 일자부터 다음 달 대금에 귀속된다.
 * 기준 카드의 대금기간 시작일과 같은 값이며, 주기 판정·범위 계산·고정비 기록일이
 * 모두 이 상수를 참조한다. 값이 파일마다 흩어져 어긋나는 것을 막으려고 한곳에 둔다.
 *
 * 봇에도 같은 규칙이 있다 (src/cron/life-cron.ts getBillingMonthForDate).
 * 프로젝트가 분리돼 있어 import가 안 되므로 변경 시 양쪽을 함께 고쳐야 한다.
 */
export const CYCLE_START_DAY = 16;

/** 결제주기 마지막 날 = 시작일 하루 전 */
export const CYCLE_END_DAY = CYCLE_START_DAY - 1;
