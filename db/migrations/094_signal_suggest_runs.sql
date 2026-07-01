-- 094: 월간 신호 제안 발송 기록 (idempotency 테이블) — #546, ADR-0053
-- monthly-signal-suggest Routine(월 1일 09:30 KST, LLM 기반, repo 밖 로컬 SKILL) 의존 테이블.
--
-- 원리: Routine 최초 액션에서 INSERT ON CONFLICT (user_id, month_start) DO NOTHING RETURNING id.
-- 같은 달 두 번째 실행이면 RETURNING이 비어서 Routine이 후보 생성·발송 전에 즉시 종료 → 중복 카드 차단.
-- Routine 재실행·스케줄러 중복 fire·프롬프트 중복 호출 어떤 원인이든 원자적으로 하나만 승리.
-- (기존 saju_weekly_reviews(062) idempotency 패턴과 동일 결. 최초-클레임 선택 근거는 ADR-0053.)

CREATE TABLE IF NOT EXISTS signal_suggest_runs (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month_start DATE NOT NULL,                              -- 해당 월 1일 (DATE_TRUNC('month', ...)::date)
  posted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, month_start)
);

CREATE INDEX IF NOT EXISTS idx_signal_suggest_runs_user_month
  ON signal_suggest_runs(user_id, month_start DESC);

COMMENT ON TABLE signal_suggest_runs IS
  'monthly-signal-suggest Routine의 idempotency 기록. UNIQUE (user_id, month_start)로 같은 달 중복 발송 차단 (#546, ADR-0053).';

DO $$
DECLARE
  has_table INT;
  has_unique INT;
BEGIN
  SELECT count(*) INTO has_table FROM information_schema.tables
   WHERE table_name = 'signal_suggest_runs';
  SELECT count(*) INTO has_unique FROM pg_constraint
   WHERE conname LIKE '%signal_suggest_runs%' AND contype = 'u';
  RAISE NOTICE '[094] signal_suggest_runs 테이블 % / UNIQUE 제약 %', has_table, has_unique;
END $$;
