/**
 * 알림 설정 쿼리.
 */

import { query } from '../db.js';

// ─── 알림 설정 쿼리 ──────────────────────────────────

export interface NotificationSettingRow {
  id: number;
  slot_name: string;
  label: string;
  time_value: string;
  active: boolean;
}

/** 알림 설정 전체 조회 */
export const queryNotificationSettings = async (): Promise<NotificationSettingRow[]> =>
  (
    await query<NotificationSettingRow>(
      'SELECT id, slot_name, label, time_value, active FROM notification_settings ORDER BY id',
    )
  ).rows;
