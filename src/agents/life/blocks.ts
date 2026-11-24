/**
 * v2 Life Agent Block Kit 빌더.
 * v1(routine/blocks, schedule/blocks) 패턴 재사용, v1 import 없이 자체 구현.
 */

export {
  ROUTINE_ACTION_ID,
  SCHEDULE_ACTION_ID,
  POSTPONE_ACTION,
  DELETE_ACTION,
  TOGGLE_IMPORTANT_ACTION,
  MOVE_TO_TODAY_ACTION,
  CONFIRM_MODIFY_EXECUTE_ACTION_ID,
  CONFIRM_MODIFY_CANCEL_ACTION_ID,
} from './blocks/constants.js';
export type { SlotFilter } from './blocks/routine.js';
export {
  parseButtonValue,
  buildRoutineBlocks,
  buildFilteredRoutineBlocks,
} from './blocks/routine.js';
export { buildMorningGreetingBlocks } from './blocks/greeting.js';
export { buildConfirmModifyCard } from './blocks/confirm-modify.js';
export { encodeOverflowValue, parseOverflowValue } from './blocks/schedule-overflow.js';
export { formatSchedulesAsText, buildScheduleBlocks } from './blocks/schedule.js';
export {
  buildScheduleText,
  buildNightScheduleText,
  buildYesterdayIncompleteText,
} from './blocks/schedule-text.js';
export { buildSleepBlocks } from './blocks/sleep.js';
