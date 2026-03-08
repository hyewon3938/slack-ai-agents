-- 일정 중요 표시 컬럼 추가
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS important BOOLEAN DEFAULT false;
