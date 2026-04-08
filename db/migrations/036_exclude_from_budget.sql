-- 지출별 예산 제외 플래그
-- 카테고리 기반 EXCLUDED_CATEGORIES 대신 건별 제어 가능
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS exclude_from_budget BOOLEAN NOT NULL DEFAULT false;

-- 기존 데이터 마이그레이션: 고정비/사업 카테고리 → 제외 처리
UPDATE expenses SET exclude_from_budget = true
WHERE category IN ('통신비', '공과금', '리커밋 사업', '리커밋 택배');

-- 예산 계산 쿼리 성능 인덱스
CREATE INDEX IF NOT EXISTS idx_expenses_budget_filter
ON expenses (user_id, date, exclude_from_budget)
WHERE COALESCE(type, 'expense') = 'expense';
