-- 051: 사주 시드 카탈로그 + 메트릭 + 일일 매칭 결과
-- ADR-0017 참조: docs/adr/0017-saju-ganji-master-normalization.md
-- 시드 단위 hit/miss outcome 보존 + 1:N 메트릭 + 일일 매칭 기록 + 검증 사이클.

CREATE TABLE IF NOT EXISTS saju_signal_catalog (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sipsin TEXT,
  description TEXT,
  trigger_target_type TEXT NOT NULL
    CHECK (trigger_target_type IN ('stem','branch','ganji','element_density','sibiunsung','relation')),
  trigger_target_id INTEGER,                    -- 마스터 FK, target_type에 따라 stems/branches/ganji 등 분기
  trigger_aux JSONB,                            -- with_natal, min_count 등 추가 조건
  active BOOLEAN NOT NULL DEFAULT true,
  source TEXT NOT NULL DEFAULT 'seed'
    CHECK (source IN ('seed','llm_promoted')),
  hit_count INTEGER NOT NULL DEFAULT 0,
  miss_count INTEGER NOT NULL DEFAULT 0,
  inconclusive_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_saju_catalog_user_active ON saju_signal_catalog(user_id, active);

CREATE TABLE IF NOT EXISTS saju_signal_metrics (
  id SERIAL PRIMARY KEY,
  signal_id INTEGER NOT NULL REFERENCES saju_signal_catalog(id) ON DELETE CASCADE,
  metric_name TEXT NOT NULL,
  expected_metric_sql TEXT NOT NULL,
  expected_direction TEXT NOT NULL
    CHECK (expected_direction IN ('above_avg','below_avg','above_abs','below_abs','flag_present')),
  expected_threshold NUMERIC,
  domain TEXT NOT NULL
    CHECK (domain IN ('schedule','routine','sleep','expense','diary_meta','audit')),
  UNIQUE (signal_id, metric_name)
);

CREATE INDEX IF NOT EXISTS idx_saju_metrics_signal ON saju_signal_metrics(signal_id);

CREATE TABLE IF NOT EXISTS saju_daily_matches (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  signal_id INTEGER NOT NULL REFERENCES saju_signal_catalog(id) ON DELETE CASCADE,
  trigger_activated BOOLEAN NOT NULL,
  metric_values JSONB,
  matched BOOLEAN,
  verify_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (verify_status IN ('pending','hit','miss','inconclusive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, date, signal_id)
);

CREATE INDEX IF NOT EXISTS idx_saju_matches_user_date ON saju_daily_matches(user_id, date);
CREATE INDEX IF NOT EXISTS idx_saju_matches_verify ON saju_daily_matches(verify_status, date)
  WHERE verify_status = 'pending';

-- notification_settings에 일일 매칭 cron 추가
INSERT INTO notification_settings (slot_name, time_value, label, active)
VALUES ('dailySajuMatching', '09:00', '사주 일일 매칭', true)
ON CONFLICT (slot_name) DO NOTHING;

-- 일기 메타 추출 cron (자정 직전, 일기 완료 시점)
INSERT INTO notification_settings (slot_name, time_value, label, active)
VALUES ('diaryMetaExtract', '23:50', '일기 메타 태그 추출', true)
ON CONFLICT (slot_name) DO NOTHING;
