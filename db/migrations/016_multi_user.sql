-- 016: 멀티유저 지원
-- users 테이블 + 전 테이블 user_id FK 추가 + 기존 데이터 마이그레이션

-- ─── 신규 테이블 ──────────────────────────────────────────

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  kakao_id BIGINT NOT NULL UNIQUE,
  nickname TEXT,
  email TEXT,
  gender TEXT,
  birthday TEXT,
  age_range TEXT,
  profile_image TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE slack_user_mappings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  slack_user_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 기존 테이블에 user_id 추가 (nullable로 먼저) ──────────

ALTER TABLE schedules ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE routine_templates ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE routine_records ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE sleep_records ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE custom_instructions ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE categories ADD COLUMN user_id INTEGER REFERENCES users(id);

-- ─── UNIQUE 제약 변경 (user_id 포함) ──────────────────────

-- sleep_records: (date) → (user_id, date, sleep_type)
ALTER TABLE sleep_records DROP CONSTRAINT IF EXISTS sleep_records_date_key;
ALTER TABLE sleep_records DROP CONSTRAINT IF EXISTS sleep_records_date_sleep_type_key;

-- categories: (name) → (user_id, name)
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_name_key;

-- ─── 인덱스 ──────────────────────────────────────────────

CREATE INDEX idx_schedules_user_id ON schedules(user_id);
CREATE INDEX idx_routine_templates_user_id ON routine_templates(user_id);
CREATE INDEX idx_routine_records_user_id ON routine_records(user_id);
CREATE INDEX idx_sleep_records_user_id ON sleep_records(user_id);
CREATE INDEX idx_custom_instructions_user_id ON custom_instructions(user_id);
CREATE INDEX idx_categories_user_id ON categories(user_id);

-- 참고: 기존 데이터 마이그레이션은 첫 카카오 로그인 시 수동으로 실행
-- 1. 첫 번째 유저(관리자)가 카카오 로그인하면 user_id=1 생성됨
-- 2. 아래 쿼리를 수동 실행:
--    UPDATE schedules SET user_id = 1 WHERE user_id IS NULL;
--    UPDATE routine_templates SET user_id = 1 WHERE user_id IS NULL;
--    UPDATE routine_records SET user_id = 1 WHERE user_id IS NULL;
--    UPDATE sleep_records SET user_id = 1 WHERE user_id IS NULL;
--    UPDATE custom_instructions SET user_id = 1 WHERE user_id IS NULL;
--    UPDATE categories SET user_id = 1 WHERE user_id IS NULL;
-- 3. NOT NULL 제약 + UNIQUE 제약 추가:
--    ALTER TABLE schedules ALTER COLUMN user_id SET NOT NULL;
--    ALTER TABLE routine_templates ALTER COLUMN user_id SET NOT NULL;
--    ALTER TABLE routine_records ALTER COLUMN user_id SET NOT NULL;
--    ALTER TABLE sleep_records ALTER COLUMN user_id SET NOT NULL;
--    ALTER TABLE custom_instructions ALTER COLUMN user_id SET NOT NULL;
--    ALTER TABLE categories ALTER COLUMN user_id SET NOT NULL;
--    ALTER TABLE sleep_records ADD CONSTRAINT sleep_records_user_date_type_unique UNIQUE (user_id, date, sleep_type);
--    ALTER TABLE categories ADD CONSTRAINT categories_user_name_unique UNIQUE (user_id, name);
