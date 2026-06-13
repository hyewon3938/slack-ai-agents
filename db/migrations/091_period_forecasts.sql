-- 091: 예측 장부 — period_forecasts (#531 / #523 Phase 3, ADR-0050)
-- 절기월(월운)·입춘년(세운) 사전등록 → 다음 전환 시 채점. 대운은 비편입(채점 주기 수명초과 = 비실증 층).
-- 신호당 1행(정규화). status·동결 baseline·예측 방향·실측(방향적중+delta)·근거 셀 provenance.
-- 자기검증: 생성·채점 모두 절기/입춘 시간 게이트(periodFortune 슬롯)만으로 무인 작동. 멱등(재실행 안전).
-- baseline_rate는 생성 시점 동결(사후 변경 차단) = 확증편향 차단 규율(사다리 Decision 3)의 코드 실현.
-- Brier 등 확률점수 금지 — 표본 없는 층에서 확률 산출은 과대주장(방향 적중 + 실측 delta만).

CREATE TABLE IF NOT EXISTS period_forecasts (
  id                  SERIAL PRIMARY KEY,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_type         TEXT NOT NULL,              -- 'wolun' | 'seun' (대운 비편입)
  period_start        DATE NOT NULL,              -- 절기월 시작 / 입춘일
  period_end          DATE NOT NULL,              -- 채점 시점 (절기월 끝 / 다음 입춘 전날)
  signal_id           INTEGER REFERENCES signal_defs(id) ON DELETE SET NULL,  -- no_call이면 NULL
  status              TEXT NOT NULL DEFAULT 'open',  -- open | scored | unmeasurable | no_call
  predicted_direction TEXT,                       -- 'up' | 'down' (no_call이면 NULL)
  baseline_rate       DOUBLE PRECISION,           -- 생성 시점 동결(대표 링크 rate_off). no_call이면 NULL
  source_cell         JSONB,                      -- 근거 셀 provenance(tier·axis·shrunk·nActive·signal) / no_call이면 사유
  measured_rate       DOUBLE PRECISION,           -- 채점: 기간 pass율. 미채점/no_call이면 NULL
  measured_delta      DOUBLE PRECISION,           -- measured_rate − baseline_rate
  direction_hit       BOOLEAN,                    -- 채점: 방향 적중
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scored_at           TIMESTAMPTZ,                -- 채점 완료(NULL=미채점)
  CHECK (period_type IN ('wolun', 'seun')),
  CHECK (status IN ('open', 'scored', 'unmeasurable', 'no_call')),
  CHECK (predicted_direction IS NULL OR predicted_direction IN ('up', 'down')),
  UNIQUE (user_id, period_type, period_start, signal_id)
);

-- no_call은 signal_id=NULL이라 위 UNIQUE가 NULL distinct로 중복 허용 → partial unique로 기간당 1행 보장(멱등).
CREATE UNIQUE INDEX IF NOT EXISTS period_forecasts_nocall_uniq
  ON period_forecasts (user_id, period_type, period_start)
  WHERE status = 'no_call';

-- 채점 대상 추출 가속(WHERE status='open' AND period_end<=today).
CREATE INDEX IF NOT EXISTS period_forecasts_open_idx
  ON period_forecasts (user_id, period_type, period_end)
  WHERE status = 'open';

COMMENT ON TABLE period_forecasts IS
  '기간(월운/세운) 예측 장부 — 절기/입춘 사전등록 → 다음 전환 채점. 신호당 1행, baseline 동결, 방향적중+실측delta(Brier 금지). 대운 비편입. 파생 성격(saju_response_profile + 만세력에서 재생성 가능하나 baseline 동결값은 보존 대상). #523 Phase 3, ADR-0050.';

DO $$
DECLARE
  tbl    INT;
  nocall INT;
  openix INT;
BEGIN
  SELECT count(*) INTO tbl FROM information_schema.tables
   WHERE table_name = 'period_forecasts';
  SELECT count(*) INTO nocall FROM pg_indexes
   WHERE indexname = 'period_forecasts_nocall_uniq';
  SELECT count(*) INTO openix FROM pg_indexes
   WHERE indexname = 'period_forecasts_open_idx';
  RAISE NOTICE '[091] period_forecasts 테이블 % / no_call partial unique % / open idx %', tbl, nocall, openix;
END $$;
