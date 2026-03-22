-- 루틴 시간대 4→2 통합: 아침+점심 → 낮, 저녁+밤 → 밤
-- routine_templates time_slot 변경
UPDATE routine_templates SET time_slot = '낮' WHERE time_slot IN ('아침', '점심');
UPDATE routine_templates SET time_slot = '밤' WHERE time_slot = '저녁';

-- notification_settings: 점심/저녁 비활성화, 밤 시간 변경
UPDATE notification_settings SET active = false WHERE slot_name IN ('lunch', 'evening');
UPDATE notification_settings SET time_value = '23:55' WHERE slot_name = 'night';
