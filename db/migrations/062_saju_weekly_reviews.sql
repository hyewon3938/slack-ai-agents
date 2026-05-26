-- 062: 주간 사주 리뷰 발송 기록 (idempotency 테이블)
-- 마스터 A — Phase A1 (weekly-saju-review-v2 Routine) 의존 테이블.
--
-- 원리: Routine이 발송 직전 INSERT ON CONFLICT (user_id, week_start) DO NOTHING RETURNING id.
-- 같은 주에 두 번째 시도하면 RETURNING이 비어서 Routine이 즉시 종료 → 중복 발송 방지.
-- Routine retry, prompt 중복 호출 어떤 원인이든 이 방어선을 통과 못 함.

CREATE TABLE IF NOT EXISTS saju_weekly_reviews (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start  DATE NOT NULL,                              -- 월요일 (해당 주 시작일)
  posted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_saju_weekly_reviews_user_week
  ON saju_weekly_reviews(user_id, week_start DESC);

COMMENT ON TABLE saju_weekly_reviews IS
  '마스터 A — weekly-saju-review-v2 Routine의 idempotency 기록. UNIQUE 제약으로 같은 (user_id, week_start) 중복 발송 차단.';
