/**
 * v2 Life Agent SQL 쿼리 레이어.
 * Notion SDK 의존성 없이 PostgreSQL 직접 조회.
 * 크론(life-cron)과 액션 핸들러(actions)에서 사용.
 */

export type {
  RoutineTrackingMode,
  RoutineTemplateRow,
  RoutineRecordRow,
} from './life/queries-routine.js';
export {
  shouldCreateToday,
  frequencyBadge,
  queryActiveTemplates,
  queryTodayRecords,
  queryExistingTemplateIds,
  queryLastRecordDate,
  createRecord,
  completeRecord,
} from './life/queries-routine.js';
export type { ScheduleRow } from './life/queries-schedule.js';
export {
  queryTodaySchedules,
  queryBacklogSchedules,
  countOverdueTasks,
  moveScheduleToDate,
  updateScheduleStatus,
  deleteSchedule,
  toggleScheduleImportant,
  postponeSchedule,
} from './life/queries-schedule.js';
export type { NotificationSettingRow } from './life/queries-notification.js';
export { queryNotificationSettings } from './life/queries-notification.js';
export type { ReminderRow } from './life/queries-reminder.js';
export {
  queryDueReminders,
  queryActiveReminderTimes,
  deactivateReminder,
  decrementReminderCount,
} from './life/queries-reminder.js';
export type { SleepRecordRow, SleepEventRow } from './life/queries-sleep.js';
export { querySleepForHome, querySleepEventsForHome } from './life/queries-sleep.js';
