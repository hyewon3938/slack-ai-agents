-- 루틴 소프트 딜리트: 삭제(숨김) vs 비활성화(일시정지) 분리
-- deleted_at이 NULL이 아니면 UI에서 완전히 숨김, DB에는 보존

ALTER TABLE routine_templates
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
