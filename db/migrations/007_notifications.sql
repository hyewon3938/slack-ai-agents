-- 알림 스케줄 설정 (크론 슬롯별 시각 관리)
CREATE TABLE IF NOT EXISTS notification_settings (
  id SERIAL PRIMARY KEY,
  slot_name TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  time_value TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 기본 7슬롯 시드
INSERT INTO notification_settings (slot_name, label, time_value) VALUES
  ('sleepCheck',       '수면 체크',   '08:50'),
  ('morningSchedule',  '아침 일정',   '09:00'),
  ('morning',          '아침 루틴',   '09:05'),
  ('lunch',            '점심',       '13:00'),
  ('evening',          '저녁',       '18:00'),
  ('night',            '밤 요약',     '22:00'),
  ('nightReview',      '밤 리뷰',     '23:00')
ON CONFLICT (slot_name) DO NOTHING;

-- 커스텀 리마인더
CREATE TABLE IF NOT EXISTS reminders (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  time_value TEXT NOT NULL,
  date DATE,
  frequency TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reminders_active
  ON reminders(active) WHERE active = true;
