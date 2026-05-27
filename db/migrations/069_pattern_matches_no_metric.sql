-- 069: pattern_matches.matched NULL 허용 + verify_status 'no_metric' 추가
-- 마스터 #434 Phase 2.
-- ADR-0027 (LLM 비동기 routine 통일) — Phase 6 LLM 매트릭 제안 슬롯이 사용할
-- evidence-only 풀셋 시드(매트릭 없음) 운영을 위해 채점 스킵 경로 추가.
--
-- 변경:
--   1) pattern_matches.matched NOT NULL → NULL 허용
--      (매트릭 없는 시드는 trigger만 평가, hit/miss 채점 보류)
--   2) verify_status CHECK constraint에 'no_metric' 추가
--      ('pending','hit','miss','inconclusive','no_metric')
--   3) idx_pattern_matches_no_metric 부분 인덱스
--      Phase 6 LLM 매트릭 제안 슬롯이 'no_metric' 행을 user_id+date로 빠르게 SELECT

BEGIN;

-- 1) matched 컬럼 NULL 허용
ALTER TABLE pattern_matches
  ALTER COLUMN matched DROP NOT NULL;

-- 2) verify_status enum 확장
ALTER TABLE pattern_matches
  DROP CONSTRAINT IF EXISTS saju_daily_matches_verify_status_check;
ALTER TABLE pattern_matches
  DROP CONSTRAINT IF EXISTS pattern_matches_verify_status_check;
ALTER TABLE pattern_matches
  ADD CONSTRAINT pattern_matches_verify_status_check
    CHECK (verify_status IN ('pending','hit','miss','inconclusive','no_metric'));

-- 3) no_metric 행 부분 인덱스 — Phase 6 evidence 풀 SELECT 가속
CREATE INDEX IF NOT EXISTS idx_pattern_matches_no_metric
  ON pattern_matches (user_id, date)
  WHERE verify_status = 'no_metric';

COMMENT ON COLUMN pattern_matches.matched IS
  'NULL(매트릭 없음, verify_status=no_metric) / true(hit) / false(miss). ADR-0027 Phase 2 evidence-only 운영.';

COMMIT;
