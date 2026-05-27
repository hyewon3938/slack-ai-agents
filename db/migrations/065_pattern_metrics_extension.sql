-- 065: pattern_metrics 컬럼 확장
-- 마스터 #434 Phase 1.
-- ADR-0023: hit/miss/inconclusive 카운터는 매트릭 단위 source of truth
-- ADR-0024: Beta-Binomial Bayesian posterior 도입 (alpha/beta/p)
-- ADR-0025: LLM 자율 매트릭 승인 게이트 (description NOT NULL + status='pending')

BEGIN;

ALTER TABLE pattern_metrics
  -- 자연어 의도 (ADR-0025) — LLM 매트릭 승인 UI에 노출, 결정론 매트릭도 채움
  ADD COLUMN description TEXT NOT NULL DEFAULT '',
  -- 평가 윈도우 길이 외부화 (SQL body에 있던 값을 컬럼으로 끌어올림)
  ADD COLUMN window_days INTEGER,
  -- 매트릭 상태 (ADR-0025: LLM 자율 매트릭은 'pending'으로 시작)
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'pending', 'rejected')),
  -- 매트릭 출처
  ADD COLUMN source TEXT NOT NULL DEFAULT 'deterministic'
    CHECK (source IN ('deterministic', 'llm_autonomous')),
  ADD COLUMN proposed_at TIMESTAMPTZ,
  ADD COLUMN approved_at TIMESTAMPTZ,
  -- hit/miss 카운터 (ADR-0023) — 매트릭 단위 source of truth
  ADD COLUMN hit_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN miss_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN inconclusive_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN last_matched_at TIMESTAMPTZ,
  -- Bayesian posterior (ADR-0024) — Beta-Binomial 사후 분포
  ADD COLUMN posterior_alpha NUMERIC(8,2) NOT NULL DEFAULT 1.0,
  ADD COLUMN posterior_beta  NUMERIC(8,2) NOT NULL DEFAULT 1.0,
  ADD COLUMN posterior_p     NUMERIC(6,4);

-- 매칭 cron이 active 매트릭만 빠르게 SELECT 하기 위한 partial index (PG 12+)
CREATE INDEX IF NOT EXISTS idx_pattern_metrics_status_active
  ON pattern_metrics (status) WHERE status = 'active';

COMMENT ON COLUMN pattern_metrics.description IS
  '매트릭 의도 자연어 설명. LLM 매트릭 승인 UI에 노출 (ADR-0025)';
COMMENT ON COLUMN pattern_metrics.window_days IS
  '평가 윈도우 길이 (일). SQL body 외부 파라미터로 끌어올림';
COMMENT ON COLUMN pattern_metrics.status IS
  'active(평가 중) / pending(LLM 자율 매트릭 승인 대기) / rejected(거절됨)';
COMMENT ON COLUMN pattern_metrics.source IS
  'deterministic(시드 카탈로그 매트릭) / llm_autonomous(LLM 자율 발견)';
COMMENT ON COLUMN pattern_metrics.hit_count IS
  'hit 누적 카운트 (ADR-0023 source of truth)';
COMMENT ON COLUMN pattern_metrics.posterior_alpha IS
  'Beta-Binomial alpha. 초기값 1.0 (uniform prior) + 누적 hit';
COMMENT ON COLUMN pattern_metrics.posterior_beta IS
  'Beta-Binomial beta. 초기값 1.0 (uniform prior) + 누적 miss';
COMMENT ON COLUMN pattern_metrics.posterior_p IS
  'Beta-Binomial 사후 평균 = alpha / (alpha + beta). NULL이면 hit+miss=0';

COMMIT;
