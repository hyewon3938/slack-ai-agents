-- 105: 수면 스키마 보강 — sleep_events 사용자 스코프 + 특이사항 태그 (#589, ADR-0059)
-- sleep_events에 user_id가 없어 사용자 스코프 조회·집계가 불가능했다 → 컬럼 추가 + 기존 행 백필.
-- NOT NULL 승격은 Phase 2 — 봇 프롬프트가 user_id를 쓰기 시작한 후.
-- sleep_records.tags = 통계 연계용 고정 어휘 태그. memo는 사람용 자유텍스트로 병행 유지.

-- ① sleep_events 사용자 스코프
ALTER TABLE sleep_events ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id);
UPDATE sleep_events SET user_id = (SELECT MIN(id) FROM users) WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_sleep_events_user_date ON sleep_events(user_id, date);

-- ② 특이사항 태그 (고정 어휘 10종 — 어휘 밖 값은 CHECK로 차단)
ALTER TABLE sleep_records ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

-- ADD CONSTRAINT는 IF NOT EXISTS가 없어 DROP 후 ADD로 idempotent 처리 (075 동일 패턴)
ALTER TABLE sleep_records
  DROP CONSTRAINT IF EXISTS chk_sleep_records_tags;

ALTER TABLE sleep_records
  ADD CONSTRAINT chk_sleep_records_tags
    CHECK (tags <@ ARRAY['악몽','화장실','뒤척임','카페인','음주','야식','스트레스','소음','통증','온도']::TEXT[]);

DO $$
DECLARE
  leftover INT;
BEGIN
  SELECT count(*) INTO leftover FROM sleep_events WHERE user_id IS NULL;
  RAISE NOTICE '[105] sleep_events user_id 백필 후 NULL 잔여 % 행 (0이어야 정상)', leftover;
END $$;
