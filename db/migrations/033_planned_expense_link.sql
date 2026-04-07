-- 지출과 예정 지출 연결 (봉투 방식)
-- 연결된 지출은 일일 예산 계산에서 제외됨
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS planned_expense_id INTEGER REFERENCES planned_expenses(id);
CREATE INDEX IF NOT EXISTS idx_expenses_planned ON expenses(planned_expense_id) WHERE planned_expense_id IS NOT NULL;
