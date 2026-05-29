-- 073: pattern_metrics에 rejected_at 컬럼 추가
-- 마스터 #434 Phase 6.
-- ADR-0030: LLM 매트릭 거절 시각. routine 재제안 시 LLM 입력에 노출하여 자율 판단 근거 제공.

BEGIN;

ALTER TABLE pattern_metrics
  ADD COLUMN rejected_at TIMESTAMPTZ;

COMMENT ON COLUMN pattern_metrics.rejected_at IS
  'LLM 매트릭 거절 시각. monthly-metric-suggest routine 재제안 시 LLM 입력에 노출 (ADR-0030)';

COMMIT;
