-- 일정
CREATE TABLE IF NOT EXISTS schedules (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  date DATE,
  end_date DATE,
  status TEXT DEFAULT 'todo',
  category TEXT,
  memo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 루틴 템플릿
CREATE TABLE IF NOT EXISTS routine_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  time_slot TEXT,
  frequency TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 루틴 일별 기록
CREATE TABLE IF NOT EXISTS routine_records (
  id SERIAL PRIMARY KEY,
  template_id INTEGER REFERENCES routine_templates(id),
  date DATE NOT NULL,
  completed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
