-- 주간 리포트 크론 슬롯 추가 (일요일만 실행, 코드에서 요일 체크)
INSERT INTO notification_settings (slot_name, label, time_value)
VALUES ('weeklyReport', '주간 리포트', '10:00')
ON CONFLICT (slot_name) DO NOTHING;
