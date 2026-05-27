-- 063: saju_signal_* → pattern_* 전면 rename
-- ADR-0026: 시스템 정체성(패턴 발견)을 직접 표현하는 어휘로 통일.
-- 마스터 #434 Phase 1. ADR-0022(Superseded)에서 결정한 테이블명 잔존 결정을 폐기.
--
-- rename 대상 (5어휘 데이터 모델: 시드 → 매트릭 → 매칭 → 가설 → 검증):
--   saju_signal_catalog → pattern_catalog
--   saju_signal_metrics → pattern_metrics
--   saju_daily_matches  → pattern_matches
--   saju_hypotheses     → pattern_hypotheses
--   saju_stats          → pattern_stats
--
-- FK 컬럼 (시드 참조): signal_id → pattern_id
-- 인덱스명도 같이 rename (가독성).
--
-- 주의: saju_influence_summary view는 본 마이그레이션에서 *깨짐* — 068에서 body 재정의로 복구.

BEGIN;

-- 테이블 rename
ALTER TABLE saju_signal_catalog RENAME TO pattern_catalog;
ALTER TABLE saju_signal_metrics RENAME TO pattern_metrics;
ALTER TABLE saju_daily_matches  RENAME TO pattern_matches;
ALTER TABLE saju_hypotheses     RENAME TO pattern_hypotheses;
ALTER TABLE saju_stats          RENAME TO pattern_stats;

-- FK 컬럼 rename (시드 참조 컬럼은 patterns_id로 통일)
ALTER TABLE pattern_metrics RENAME COLUMN signal_id TO pattern_id;
ALTER TABLE pattern_matches RENAME COLUMN signal_id TO pattern_id;

-- 인덱스명 rename
ALTER INDEX idx_saju_catalog_user_active   RENAME TO idx_pattern_catalog_user_active;
ALTER INDEX idx_saju_metrics_signal        RENAME TO idx_pattern_metrics_pattern;
ALTER INDEX idx_saju_matches_user_date     RENAME TO idx_pattern_matches_user_date;
ALTER INDEX idx_saju_matches_verify        RENAME TO idx_pattern_matches_verify;
ALTER INDEX idx_saju_hypotheses_status     RENAME TO idx_pattern_hypotheses_status;
ALTER INDEX idx_saju_stats_hypothesis_week RENAME TO idx_pattern_stats_hypothesis_week;

COMMIT;
