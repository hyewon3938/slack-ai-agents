-- 루틴 기록에 메모 + 완료 시점 추가
ALTER TABLE routine_records ADD COLUMN IF NOT EXISTS memo TEXT;
ALTER TABLE routine_records ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
