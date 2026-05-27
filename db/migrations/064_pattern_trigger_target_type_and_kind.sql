-- 064: trigger_target_type CHECK constraint 확장 + pattern_kind 컬럼
-- ADR-0022 (Superseded by ADR-0026): target-type 일반화 (사주 6종 + life_signal)
-- ADR-0026: pattern_kind 컬럼으로 시드 출처 구분
--
-- 변경:
--   CHECK constraint에 'life_signal' 추가 (요일·계절 등 결정론적 환경 변수)
--   pattern_kind 컬럼 신설 (saju / life_signal) — Phase 4부터 분기 기준

BEGIN;

-- 기존 CHECK constraint 제거 (자동 생성된 이름 사용)
-- saju_signal_catalog가 pattern_catalog로 rename됐지만 CHECK constraint 이름은 유지됨
ALTER TABLE pattern_catalog
  DROP CONSTRAINT saju_signal_catalog_trigger_target_type_check;

-- 새 CHECK constraint (life_signal 추가)
ALTER TABLE pattern_catalog
  ADD CONSTRAINT pattern_catalog_trigger_target_type_check
    CHECK (trigger_target_type IN
      ('stem', 'branch', 'ganji', 'element_density', 'sibiunsung', 'relation', 'life_signal'));

-- pattern_kind: 시드 출처 구분
ALTER TABLE pattern_catalog
  ADD COLUMN pattern_kind TEXT NOT NULL DEFAULT 'saju'
    CHECK (pattern_kind IN ('saju', 'life_signal'));

COMMENT ON COLUMN pattern_catalog.pattern_kind IS
  '시드 출처: saju(60갑자 매핑) / life_signal(요일·계절 등 결정론적 환경 변수)';

COMMIT;
