-- 019: 사주 프로필 상세 필드 추가 (신강/중화/신약, 희신, 기신, 한신)

ALTER TABLE saju_profiles
  ADD COLUMN IF NOT EXISTS strength TEXT,
  ADD COLUMN IF NOT EXISTS heeshin TEXT,
  ADD COLUMN IF NOT EXISTS gishin TEXT,
  ADD COLUMN IF NOT EXISTS hanshin TEXT;

COMMENT ON COLUMN saju_profiles.strength IS '신강/중화/신약 (strong/neutral/weak)';
COMMENT ON COLUMN saju_profiles.heeshin IS '희신 (喜神)';
COMMENT ON COLUMN saju_profiles.gishin IS '기신 (忌神)';
COMMENT ON COLUMN saju_profiles.hanshin IS '한신 (閑神)';
