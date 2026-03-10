-- 카테고리 관리 테이블 (색상, 순서 등 메타데이터)
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT 'gray',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 기존 일정에서 카테고리 시드 데이터 추출
INSERT INTO categories (name, color, sort_order)
SELECT DISTINCT category,
  CASE category
    WHEN '개인' THEN 'violet'
    WHEN '사업' THEN 'amber'
    WHEN '약속' THEN 'rose'
    WHEN '건강' THEN 'emerald'
    WHEN '공부' THEN 'sky'
    ELSE 'gray'
  END,
  ROW_NUMBER() OVER (ORDER BY category)
FROM schedules
WHERE category IS NOT NULL
ON CONFLICT (name) DO NOTHING;
