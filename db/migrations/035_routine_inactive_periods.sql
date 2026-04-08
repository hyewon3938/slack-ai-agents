-- 루틴 시작일 추가 (기존 created_at 기반 백필)
ALTER TABLE routine_templates ADD COLUMN start_date DATE;
UPDATE routine_templates SET start_date = created_at::date WHERE start_date IS NULL;
ALTER TABLE routine_templates ALTER COLUMN start_date SET NOT NULL;
ALTER TABLE routine_templates ALTER COLUMN start_date SET DEFAULT CURRENT_DATE;

-- 비활성 기간 테이블
CREATE TABLE routine_inactive_periods (
  id SERIAL PRIMARY KEY,
  template_id INTEGER NOT NULL REFERENCES routine_templates(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  start_date DATE NOT NULL,
  end_date DATE,              -- NULL = 현재 비활성 중
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_routine_inactive_template ON routine_inactive_periods(template_id);
CREATE INDEX idx_routine_inactive_user ON routine_inactive_periods(user_id);
