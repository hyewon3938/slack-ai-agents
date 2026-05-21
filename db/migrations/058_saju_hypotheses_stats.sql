-- ADR-0019 Phase 4: 가설-검증 정량 파이프라인
-- saju_hypotheses: 등록된 가설 정의 (시드 catalog 참조 또는 신규 조합)
-- saju_stats: 주간 검증 결과 시계열 (Fisher's exact + BH-FDR 결과)

CREATE TABLE IF NOT EXISTS saju_hypotheses (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trigger_spec    JSONB NOT NULL,                       -- {type:'seed',signalId:N} 또는 {type:'composite',...}
  enum_target     TEXT NOT NULL,                        -- diary_meta_tags.tag
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'confirmed', 'rejected', 'archived')),
  source          TEXT NOT NULL DEFAULT 'discovery'
                  CHECK (source IN ('discovery', 'manual')),
  registered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at    TIMESTAMPTZ,
  rejected_at     TIMESTAMPTZ,
  archived_at     TIMESTAMPTZ,
  notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_saju_hypotheses_status
  ON saju_hypotheses(user_id, status);

CREATE TABLE IF NOT EXISTS saju_stats (
  id              SERIAL PRIMARY KEY,
  hypothesis_id   INTEGER NOT NULL REFERENCES saju_hypotheses(id) ON DELETE CASCADE,
  week_start      DATE NOT NULL,                        -- 월요일 (전주 윈도우의 시작일)
  n_trigger_days  INTEGER NOT NULL,                     -- trigger 발현일 수 (해당 윈도우 + baseline 누적)
  n_total_days    INTEGER NOT NULL,                     -- 분석 대상 전체 일수
  rate_trigger    NUMERIC(6,4) NOT NULL,                -- trigger 발현일의 enum 빈도
  rate_baseline   NUMERIC(6,4) NOT NULL,                -- 비발현일의 enum 빈도
  rate_ratio      NUMERIC(8,4) NOT NULL,                -- rate_trigger / rate_baseline (NaN 가능)
  raw_p           NUMERIC(10,8) NOT NULL,               -- Fisher's exact p-value (NaN = skip)
  fdr_q           NUMERIC(10,8) NOT NULL,               -- BH-FDR q-value (NaN = skip)
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (hypothesis_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_saju_stats_hypothesis_week
  ON saju_stats(hypothesis_id, week_start DESC);
