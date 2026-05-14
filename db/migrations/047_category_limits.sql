-- 047: category_limits — 카테고리별 결제주기 한도
-- 사용자가 카테고리당 N회로 한도를 정하면, 매 결제주기마다 expenses 테이블에서 집계해
-- 사용 횟수를 동적으로 계산한다 (별도 cycle 저장 없음, target만 보존).
-- UNIQUE(user_id, category): 동일 카테고리에 한도 두 개 불가.

CREATE TABLE IF NOT EXISTS category_limits (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  target_count INTEGER NOT NULL CHECK (target_count > 0 AND target_count <= 50),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, category)
);

CREATE INDEX IF NOT EXISTS idx_category_limits_user ON category_limits(user_id);
