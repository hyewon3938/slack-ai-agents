-- 017: 리마인더 반복 패턴 확장 (매주 요일/매월 날짜/격주/격월)

ALTER TABLE reminders
  ADD COLUMN IF NOT EXISTS days_of_week INTEGER[],
  ADD COLUMN IF NOT EXISTS days_of_month INTEGER[],
  ADD COLUMN IF NOT EXISTS repeat_interval INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS reference_date DATE;

COMMENT ON COLUMN reminders.days_of_week IS '반복 요일 (0=일, 1=월, ..., 6=토). frequency=매주 시 사용';
COMMENT ON COLUMN reminders.days_of_month IS '반복 날짜 (1-31). frequency=매월 시 사용';
COMMENT ON COLUMN reminders.repeat_interval IS '반복 간격 (1=매주/매월, 2=격주/격월)';
COMMENT ON COLUMN reminders.reference_date IS '간격 계산 기준일 (격주/격월 시 첫 실행일)';
