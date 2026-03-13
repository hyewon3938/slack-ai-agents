-- 카테고리 유형: task(할일, 상태 추적) vs event(일정, 날짜만)
ALTER TABLE categories
ADD COLUMN type TEXT DEFAULT 'task' CHECK (type IN ('task', 'event'));
