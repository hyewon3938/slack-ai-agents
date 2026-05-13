-- Stage 2-1: 빅뱅 마이그레이션
--
-- 새 컬럼 추가 → backfill → FK 제약 → 기존 TEXT 컬럼 제거.
-- 단일 트랜잭션이므로 중간 실패 시 자동 ROLLBACK.
--
-- 실행 전 확인:
--   - 01-backup.sql 완료 (DB 내부 백업)
--   - pg_dump 파일 생성 완료 (외부 백업)
--   - 02-recovery.sql 실행 (rename 복구)
--   - 03-verify-prematch.sql 결과 모두 0행

BEGIN;

-- 1) 새 컬럼 추가 (nullable — 백로그/카테고리 미지정 row 위해)
ALTER TABLE schedules ADD COLUMN category_id INTEGER;

-- 2) backfill
--    subcategory가 있으면 child id, 없으면 top category id
UPDATE schedules s
SET category_id = COALESCE(
  -- subcategory 우선 (leaf)
  (SELECT c.id FROM categories c
   JOIN categories p ON c.parent_id = p.id
   WHERE c.name = s.subcategory
     AND p.name = s.category
     AND c.user_id = s.user_id),
  -- 없으면 top
  (SELECT id FROM categories
   WHERE name = s.category
     AND user_id = s.user_id
     AND parent_id IS NULL)
)
WHERE s.user_id = 1
  AND s.category IS NOT NULL;

-- 3) 매칭 실패 가드 (이론상 03-verify-prematch에서 걸러졌어야 함)
DO $$
DECLARE failed INTEGER;
BEGIN
  SELECT COUNT(*) INTO failed FROM schedules
  WHERE category IS NOT NULL
    AND category_id IS NULL
    AND user_id = 1;
  IF failed > 0 THEN
    RAISE EXCEPTION 'category_id 매칭 실패 row: %. 트랜잭션 자동 롤백.', failed;
  END IF;
END $$;

-- 4) FK 제약
ALTER TABLE schedules
  ADD CONSTRAINT fk_schedules_category
  FOREIGN KEY (category_id)
  REFERENCES categories(id)
  ON DELETE RESTRICT;

-- 5) 인덱스 추가 (카테고리 필터링 쿼리 성능)
CREATE INDEX IF NOT EXISTS idx_schedules_category_id ON schedules(category_id);

-- 6) 기존 TEXT 컬럼 제거
ALTER TABLE schedules DROP COLUMN category;
ALTER TABLE schedules DROP COLUMN subcategory;

COMMIT;
