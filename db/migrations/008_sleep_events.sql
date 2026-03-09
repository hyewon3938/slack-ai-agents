-- 수면 중간 기상 이벤트 기록
CREATE TABLE IF NOT EXISTS sleep_events (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  event_time TEXT NOT NULL,        -- 'HH:MM' 형식
  memo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
