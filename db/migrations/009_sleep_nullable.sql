-- 수면 기록: bedtime/wake_time/duration_minutes nullable 허용
-- 메모 전용 레코드 지원 (수면 패턴/습관 관찰 기록용)
ALTER TABLE sleep_records ALTER COLUMN bedtime DROP NOT NULL;
ALTER TABLE sleep_records ALTER COLUMN wake_time DROP NOT NULL;
ALTER TABLE sleep_records ALTER COLUMN duration_minutes DROP NOT NULL;
