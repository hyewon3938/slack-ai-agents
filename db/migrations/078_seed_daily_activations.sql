-- 078: pattern_matches → seed_daily_activations 전환 (#477 P2, ADR-0033)
-- 검증 진실은 pattern_links 단일. 이 테이블은 "오늘 발현 시드" 일별 핸드오프 로그로 강등.
-- (daily-insight #insight + saju_influence_summary recent tier + pillar-level이 소비, ADR-0031)
--
-- 주간 검증 엔진(P2)이 raw에서 윈도우를 결정론 재계산하므로 일별 검증 컬럼은 죽은 코드 → 제거.
-- 테이블 이름만 정직하게(검증 단위 아님). 컬럼 rename(pattern_id→seed_id)은 안 함 —
-- daily-insight SKILL / pillar-level 쿼리 churn·리스크 최소화.

-- ─── A. rename ───────────────────────────────────────────
-- Postgres rename은 view 의존을 OID로 추적 → saju_influence_summary.recent_raw가
-- pattern_matches를 참조해도 자동으로 새 이름을 따라감 (view 재정의 불필요).
ALTER TABLE pattern_matches RENAME TO seed_daily_activations;

-- ─── B. 검증 컬럼 DROP ────────────────────────────────────
-- recent_raw는 user_id·pattern_id·date·trigger_activated만 사용 → 아래 컬럼 의존 없음(DROP 안전).
ALTER TABLE seed_daily_activations DROP COLUMN metric_values;   -- JSONB (일별 매트릭 스냅샷)
ALTER TABLE seed_daily_activations DROP COLUMN verify_status;   -- 일별 verify 상태 (주간 엔진 이관)
ALTER TABLE seed_daily_activations DROP COLUMN error_message;   -- 일별 평가 오류 JSONB

COMMENT ON TABLE seed_daily_activations IS
  '오늘 발현 시드 일별 핸드오프 로그 (#477 P2). 07:00 매칭 cron이 당일 trigger 발현을 transient 기록 → daily-insight(#insight)·saju_influence_summary recent tier·pillar-level이 소비. 검증 진실 아님(그건 pattern_links/주간 엔진). 컬럼: date·pattern_id(시드)·trigger_activated·matched. UNIQUE(user_id,date,pattern_id) 멱등.';

-- ─── C. 정합 검증 (rename·DROP은 행 미삭제 → 데이터 손실 0, RAISE 시 파일 트랜잭션 롤백) ──
DO $$
DECLARE
  n_rows BIGINT;
  leftover INT;
  view_rows BIGINT;
BEGIN
  -- 새 이름으로 행 보존 확인 (DDL은 행을 지우지 않음)
  SELECT count(*) INTO n_rows FROM seed_daily_activations;

  -- 검증 컬럼 3개 제거 확인
  SELECT count(*) INTO leftover
  FROM information_schema.columns
  WHERE table_name = 'seed_daily_activations'
    AND column_name IN ('metric_values', 'verify_status', 'error_message');
  IF leftover <> 0 THEN
    RAISE EXCEPTION '[078] 검증 컬럼 잔존 % 개 — DROP 실패', leftover;
  END IF;

  -- 의존 view 자동 추종(rename 후 컴파일) 확인
  SELECT count(*) INTO view_rows FROM saju_influence_summary;

  RAISE NOTICE '[078] seed_daily_activations 전환 OK — % rows, saju_influence_summary % rows', n_rows, view_rows;
END $$;
