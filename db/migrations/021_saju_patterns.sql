-- 021: 사주 패턴 분석 — 일기↔일운 상관 패턴 저장

CREATE TABLE saju_patterns (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),

  -- 패턴 유형/트리거
  pattern_type TEXT NOT NULL,          -- sipsin(십신), ganji(특정 글자), relation(합/형/충), sibiunsung(십이운성)
  trigger_element TEXT NOT NULL,       -- 편재, 사화, 인묘합, 장생 등

  -- 패턴 내용
  description TEXT NOT NULL,           -- "편재 기운 들어올 때 일을 더 벌이고 수습이 안 됨"
  evidence JSONB NOT NULL DEFAULT '[]', -- [{date, diary_excerpt, fortune_element}]

  -- 활성 관리
  active BOOLEAN DEFAULT false,        -- detection_count >= 2 시 활성화
  detection_count INTEGER DEFAULT 1,
  first_detected DATE,
  last_detected DATE,
  activated_at TIMESTAMPTZ,
  deactivated_at TIMESTAMPTZ,

  -- 메타
  source TEXT DEFAULT 'auto',          -- auto(월간 회고) / user(사용자 직접)
  confidence TEXT,                     -- high/medium/low (Opus 판단)

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_saju_patterns_user_active ON saju_patterns(user_id, active);

COMMENT ON TABLE saju_patterns IS '사주 구조적 반응 패턴 — 일기↔일운 상관 분석 결과';
COMMENT ON COLUMN saju_patterns.pattern_type IS 'sipsin(십신) / ganji(특정 글자) / relation(합/형/충) / sibiunsung(십이운성)';
COMMENT ON COLUMN saju_patterns.trigger_element IS '패턴 트리거 요소 (편재, 사화, 인묘합, 장생 등)';
COMMENT ON COLUMN saju_patterns.evidence IS '근거 목록 [{date, diary_excerpt, fortune_element}]';
COMMENT ON COLUMN saju_patterns.confidence IS 'Opus 판단 신뢰도 (high/medium/low)';
