-- 스마트 메모리: 카테고리 분류 + 자동 감지 + soft-delete
ALTER TABLE custom_instructions
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT '기타',
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_ci_active_category
  ON custom_instructions(category) WHERE active = true;
