/**
 * v4 크론 오케스트레이터.
 * DB(notification_settings)에서 스케줄 로드 → 동적 크론 등록.
 * 리마인더 체커: 매분 실행, reminders 테이블 조회 → 채널 전송.
 */

export type { LifeCronConfig } from './life/types.js';
export { calcRoutineStats, createTodayRecords } from './life/routine-records.js';
export {
  calcYesterdayFlexSpent,
  CYCLE_START_DAY,
  getBillingMonthForDate,
} from './life/budget-backfill.js';
export {
  TARGET_EXPIRY_WARN_DAYS,
  getTargetExpiryDate,
  buildTargetExpiryWarning,
  warnTargetExpiryIfNear,
} from './life/target-expiry.js';
export { timeToCron } from './life/slot-tasks.js';
export { RELOAD_DEBOUNCE_MS, CronScheduler } from './life/scheduler.js';
