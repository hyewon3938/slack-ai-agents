-- 018: 일기/고민 기록 — diary_entries + life_themes

-- ─── 일기 (날짜별 누적) ──────────────────────────────────

CREATE TABLE diary_entries (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  date DATE NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date)
);

CREATE INDEX idx_diary_entries_user_date ON diary_entries(user_id, date);

-- ─── 삶의 테마/고민 ──────────────────────────────────────

CREATE TABLE life_themes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  theme TEXT NOT NULL,
  category TEXT,
  detail TEXT,
  active BOOLEAN DEFAULT true,
  source TEXT DEFAULT 'user',
  first_mentioned DATE,
  mention_count INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_life_themes_user_active ON life_themes(user_id, active) WHERE active = true;
