-- 020: fortune_analyses에 period 구분 추가 (일운/월운/세운/대운)

-- period 컬럼 추가 (기본값: daily → 기존 데이터 호환)
ALTER TABLE fortune_analyses
  ADD COLUMN IF NOT EXISTS period TEXT DEFAULT 'daily';

-- day_pillar NOT NULL 제약 해제 (월운/세운/대운은 일주가 없을 수 있음)
ALTER TABLE fortune_analyses
  ALTER COLUMN day_pillar DROP NOT NULL;

-- UNIQUE 제약 변경: (user_id, date) → (user_id, date, period)
ALTER TABLE fortune_analyses
  DROP CONSTRAINT IF EXISTS fortune_analyses_user_id_date_key;

ALTER TABLE fortune_analyses
  ADD CONSTRAINT fortune_analyses_user_id_date_period_key UNIQUE(user_id, date, period);

COMMENT ON COLUMN fortune_analyses.period IS 'daily(일운) / monthly(월운) / yearly(세운) / major(대운)';
