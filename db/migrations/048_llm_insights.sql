-- 프로액티브 인사이트 v2 Phase 2 — LLM 자율 발견 + outcome 검증
-- ADR-0016 참조: docs/adr/0016-llm-autonomous-slot-outcome-verification.md

CREATE TABLE IF NOT EXISTS llm_insights (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  slot TEXT NOT NULL,
  signal_text TEXT NOT NULL,
  hypothesis_text TEXT NOT NULL,
  domains TEXT[] NOT NULL,
  confidence TEXT NOT NULL
    CHECK (confidence IN ('high','medium')),
  verification_sql TEXT NOT NULL,
  verification_result_type TEXT NOT NULL
    CHECK (verification_result_type IN ('boolean','scalar_count','ratio')),
  verify_at TIMESTAMPTZ NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'pending'
    CHECK (outcome IN ('pending','hit','miss','inconclusive')),
  verified_at TIMESTAMPTZ,
  verification_result_json JSONB,
  verification_error TEXT,
  shown_in_slot_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_llm_insights_user_pending ON llm_insights (user_id, verify_at)
  WHERE outcome = 'pending';
CREATE INDEX IF NOT EXISTS idx_llm_insights_user_outcome ON llm_insights (user_id, outcome, discovered_at DESC);

INSERT INTO notification_settings (slot_name, time_value, label, active)
VALUES
  ('weeklyLlmInsight',  '09:30', '주간 LLM 자율 발견', true),
  ('monthlyLlmInsight', '09:30', '월간 LLM 자율 발견', true),
  ('verifyLlmInsights', '09:10', 'LLM 발견 자동 검증', true)
ON CONFLICT (slot_name) DO NOTHING;
