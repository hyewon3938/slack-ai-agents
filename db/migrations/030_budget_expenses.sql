-- 지출 기록
CREATE TABLE expenses (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  date DATE NOT NULL,
  amount INTEGER NOT NULL,
  category VARCHAR(50) NOT NULL,
  description TEXT,
  payment_method VARCHAR(30) DEFAULT '카드',
  is_installment BOOLEAN DEFAULT false,
  installment_num INTEGER,
  installment_total INTEGER,
  installment_group VARCHAR(100),
  source VARCHAR(10) DEFAULT 'manual',
  memo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_expenses_user_date ON expenses(user_id, date);
CREATE INDEX idx_expenses_user_category ON expenses(user_id, category);

-- 월 고정비
CREATE TABLE fixed_costs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name VARCHAR(100) NOT NULL,
  amount INTEGER NOT NULL,
  category VARCHAR(50),
  is_variable BOOLEAN DEFAULT false,
  day_of_month INTEGER,
  active BOOLEAN DEFAULT true,
  memo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 고정비 월별 실적 (변동 금액 기록용)
CREATE TABLE fixed_cost_records (
  id SERIAL PRIMARY KEY,
  fixed_cost_id INTEGER NOT NULL REFERENCES fixed_costs(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  year_month VARCHAR(7) NOT NULL,
  actual_amount INTEGER NOT NULL,
  memo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(fixed_cost_id, year_month)
);

-- 예산 설정
CREATE TABLE budgets (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  year_month VARCHAR(7) NOT NULL,
  total_budget INTEGER,
  daily_budget INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, year_month)
);

-- 자산/자금 현황
CREATE TABLE assets (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name VARCHAR(100) NOT NULL,
  balance INTEGER NOT NULL,
  type VARCHAR(20) NOT NULL,
  available_amount INTEGER,
  is_emergency BOOLEAN DEFAULT false,
  memo TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 수입 기록 (리커밋 등)
CREATE TABLE incomes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  date DATE NOT NULL,
  amount INTEGER NOT NULL,
  source VARCHAR(50) NOT NULL,
  description TEXT,
  is_settled BOOLEAN DEFAULT false,
  memo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_incomes_user_date ON incomes(user_id, date);
