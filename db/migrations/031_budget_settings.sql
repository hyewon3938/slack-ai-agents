-- 예산 분석 설정 (목표 기간 등)
CREATE TABLE budget_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  target_date VARCHAR(7),  -- YYYY-MM (런웨이 목표 기간)
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
