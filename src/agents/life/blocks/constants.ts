/**
 * Life Agent Block Kit 공용 상수 (action id, 표시 한도, 시간대 순서).
 */

// ─── 상수 ───────────────────────────────────────────────

export const ROUTINE_ACTION_ID = 'life_routine_complete';
export const SCHEDULE_ACTION_ID = 'life_schedule_status';
export const POSTPONE_ACTION = 'postpone';
export const DELETE_ACTION = 'delete';
export const TOGGLE_IMPORTANT_ACTION = 'toggle_important';
export const MOVE_TO_TODAY_ACTION = 'move_today';
export const CONFIRM_MODIFY_EXECUTE_ACTION_ID = 'life_confirm_modify_execute';
export const CONFIRM_MODIFY_CANCEL_ACTION_ID = 'life_confirm_modify_cancel';

export const CONFIRM_ROW_LIMIT = 20;

export const TIME_SLOT_ORDER = ['낮', '밤'] as const;
