-- 075: 마스터 #434 Phase 8a 잔여 정리
-- A. pattern_catalog deprecated 카운터 컬럼 DROP (Phase 4 머지 후 무사용 검증됨)
-- B. pattern_matches에 시드 SQL 오류 기록을 위한 error_message JSONB + verify_status='error' enum 추가

-- A. catalog deprecated 카운터 DROP
ALTER TABLE pattern_catalog
  DROP COLUMN IF EXISTS hit_count,
  DROP COLUMN IF EXISTS miss_count,
  DROP COLUMN IF EXISTS inconclusive_count,
  DROP COLUMN IF EXISTS last_matched_at;

-- B. pattern_matches 에러 row 지원
ALTER TABLE pattern_matches
  ADD COLUMN IF NOT EXISTS error_message JSONB;

ALTER TABLE pattern_matches
  DROP CONSTRAINT IF EXISTS pattern_matches_verify_status_check;

ALTER TABLE pattern_matches
  ADD CONSTRAINT pattern_matches_verify_status_check
    CHECK (verify_status IN ('pending', 'hit', 'miss', 'inconclusive', 'no_metric', 'error'));

COMMENT ON COLUMN pattern_matches.error_message IS
  '시드 평가 중 SQL/시스템 오류 발생 시 reason/stack 일부 기록 (verify_status=error). NULL = 정상 row.';
