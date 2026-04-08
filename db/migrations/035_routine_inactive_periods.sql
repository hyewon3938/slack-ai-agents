-- 루틴 시작일 추가 (첫 기록 날짜 또는 created_at 중 빠른 쪽으로 백필)
ALTER TABLE routine_templates ADD COLUMN start_date DATE;
UPDATE routine_templates t
SET start_date = LEAST(
  t.created_at::date,
  COALESCE((SELECT MIN(r.date) FROM routine_records r WHERE r.template_id = t.id), t.created_at::date)
);
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
