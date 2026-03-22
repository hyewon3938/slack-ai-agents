-- 낮 알림 시간 통일: 일정 09:00 → 루틴 09:01
UPDATE notification_settings SET time_value = '09:01' WHERE slot_name = 'morning';
