-- 053: 사주 일일 매칭 보조 인프라
-- ADR-0017 참조. 일기 메타 플래그(LLM이 일기 텍스트 → 고정 enum만 추출),
-- 일정 변경 audit, 루틴 카테고리.
-- v2 헌장: 일기 원문은 저장하지 않고 enum 플래그만 보존 (LLM 텍스트 의존 최소화).

-- 일기 메타 플래그 (고정 enum 태그만)
CREATE TABLE IF NOT EXISTS diary_meta_tags (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  tag TEXT NOT NULL
    CHECK (tag IN (
      'irritation','health_complaint','low_energy','mood_down','confidence_high',
      'analytical_mode','deep_thought','rest','peaceful','mood_high',
      'cooking','creating','talkative','nostalgia','anxiety','past_memory'
    )),
  source TEXT NOT NULL DEFAULT 'llm',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, date, tag)
);

CREATE INDEX IF NOT EXISTS idx_diary_meta_user_date ON diary_meta_tags(user_id, date);

-- 일정 변경 audit (PATCH/UPDATE 시점 시점 기록)
CREATE TABLE IF NOT EXISTS schedule_changes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  change_type TEXT NOT NULL
    CHECK (change_type IN ('date_changed','status_changed','category_changed','title_changed','memo_changed')),
  before_value JSONB,
  after_value JSONB,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schedule_changes_user_changed
  ON schedule_changes(user_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_schedule_changes_schedule
  ON schedule_changes(schedule_id, change_type);

-- 루틴 카테고리
ALTER TABLE routine_templates ADD COLUMN IF NOT EXISTS category TEXT;
