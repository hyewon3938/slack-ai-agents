-- 017: 명리학 일운 분석 — saju_profiles + fortune_analyses

-- ─── 사주 프로필 ──────────────────────────────────────────

CREATE TABLE saju_profiles (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  -- 원국 4주
  year_pillar TEXT NOT NULL,
  month_pillar TEXT NOT NULL,
  day_pillar TEXT NOT NULL,
  hour_pillar TEXT NOT NULL,
  -- 대운 정보
  gender TEXT NOT NULL,
  daewun_start_age INTEGER,
  daewun_direction TEXT NOT NULL,
  daewun_list JSONB,
  -- 분석 기반
  gyeokguk TEXT,
  yongshin TEXT,
  profile_summary TEXT,
  -- 생년월일시 (만세력 계산용)
  birth_date DATE,
  birth_time TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_saju_profiles_user_id ON saju_profiles(user_id);

-- ─── 일운 분석 결과 ──────────────────────────────────────

CREATE TABLE fortune_analyses (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  date DATE NOT NULL,
  -- 간지 정보
  day_pillar TEXT NOT NULL,
  month_pillar TEXT,
  year_pillar TEXT,
  -- 분석 결과
  analysis TEXT NOT NULL,
  summary TEXT,
  warnings JSONB,
  recommendations JSONB,
  advice TEXT,
  -- 메타
  model TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date)
);

CREATE INDEX idx_fortune_analyses_user_date ON fortune_analyses(user_id, date);

-- ─── insight 채널 크론 슬롯 ──────────────────────────────

INSERT INTO notification_settings (slot_name, label, time_value)
VALUES
  ('insightMorning', '일운 분석 알림', '08:00'),
  ('insightNight', '일기 리마인더', '23:00')
ON CONFLICT (slot_name) DO NOTHING;
