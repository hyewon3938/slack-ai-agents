CREATE TABLE IF NOT EXISTS daily_budget_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL DEFAULT 1,
  date DATE NOT NULL,
  billing_month VARCHAR(7) NOT NULL,  -- 결제주기 기준 (e.g. '2026-04')
  budget INTEGER NOT NULL,            -- 그날 할당 예산 (todayBudget)
  spent INTEGER NOT NULL,             -- 그날 자유 지출 (todayFlexSpent)
  saved INTEGER NOT NULL,             -- budget - spent (음수 = 초과)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_daily_budget_logs_month
ON daily_budget_logs (user_id, billing_month, date);
