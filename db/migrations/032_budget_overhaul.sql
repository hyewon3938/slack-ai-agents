-- 예정 지출 테이블 (특정 월에 미리 계획한 지출)
CREATE TABLE IF NOT EXISTS planned_expenses (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  year_month VARCHAR(7) NOT NULL,  -- YYYY-MM (결제주기 기준)
  amount INTEGER NOT NULL,
  memo VARCHAR(200),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_planned_expenses_user_month
  ON planned_expenses(user_id, year_month);

-- 지출 테이블에 type 컬럼 추가 (expense/income)
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS type VARCHAR(10) DEFAULT 'expense';

-- 기존 '환불' 카테고리 → income 타입으로 변환
UPDATE expenses SET type = 'income' WHERE category = '환불';
