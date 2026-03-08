-- 수면 기록
CREATE TABLE IF NOT EXISTS sleep_records (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  bedtime TEXT NOT NULL,
  wake_time TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  memo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
