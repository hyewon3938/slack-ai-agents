-- 수면 유형 컬럼 추가 (본잠/낮잠 구분) + date UNIQUE 제약 해제
ALTER TABLE sleep_records ADD COLUMN IF NOT EXISTS sleep_type TEXT NOT NULL DEFAULT 'night';

-- date UNIQUE 제약 제거 (하루에 본잠 + 낮잠 여러 건 가능)
ALTER TABLE sleep_records DROP CONSTRAINT IF EXISTS sleep_records_date_key;
