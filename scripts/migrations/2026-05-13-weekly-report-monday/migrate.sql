-- 주간 리포트 발송 시각 이동: 일요일 23:00 → 월요일 09:00
-- 배경: 지난주 회고가 월요일 아침에 더 자연스러우며, 일요일 23:00은 아직 하루가 끝나지 않은 시점

BEGIN;

UPDATE notification_settings
SET time_value = '09:00',
    label = '주간 리포트 (월요일 아침)'
WHERE slot_name = 'weeklyReport';

COMMIT;
