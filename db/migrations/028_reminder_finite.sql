-- 리마인더 유한 반복 지원: 종료 날짜 + 남은 횟수
ALTER TABLE reminders ADD COLUMN end_date DATE;
ALTER TABLE reminders ADD COLUMN remaining_count INTEGER;
