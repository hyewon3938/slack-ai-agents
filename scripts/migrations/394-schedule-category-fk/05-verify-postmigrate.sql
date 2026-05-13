-- Stage 2-2: 사후 검증
--
-- 04-migrate.sql COMMIT 직후 실행하여 마이그레이션이 정상 완료됐는지 확인.

-- (1) row count 일치
SELECT 'row count' AS check_name,
  (SELECT COUNT(*) FROM schedules WHERE user_id = 1) AS current_rows,
  (SELECT COUNT(*) FROM schedules_backup_20260513 WHERE user_id = 1) AS backup_rows;
-- → 같아야 함

-- (2) dangling FK 검사 (FK 제약으로 사실상 0 보장이지만 확인)
SELECT 'dangling fk' AS check_name,
  COUNT(*) AS dangling_count
FROM schedules s
WHERE s.user_id = 1
  AND s.category_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM categories c WHERE c.id = s.category_id);
-- → 0

-- (3) NULL/카테고리/백로그 분포
SELECT 'distribution' AS check_name,
  COUNT(*) FILTER (WHERE category_id IS NULL) AS null_category,
  COUNT(*) FILTER (WHERE category_id IS NOT NULL) AS with_category,
  COUNT(*) FILTER (WHERE date IS NULL) AS backlog,
  COUNT(*) AS total
FROM schedules
WHERE user_id = 1;

-- (4) backup 대비 카테고리 매핑 분포 비교
--     backup에 category 있었던 row가 모두 category_id 받았는지
SELECT 'backup vs now (had category)' AS check_name,
  (SELECT COUNT(*) FROM schedules_backup_20260513 WHERE user_id = 1 AND category IS NOT NULL) AS backup_had_category,
  (SELECT COUNT(*) FROM schedules WHERE user_id = 1 AND category_id IS NOT NULL) AS now_has_id;
-- → 같아야 함

-- (5) 스키마 변경 확인 (수동)
\d schedules
-- → category, subcategory 컬럼 없음 / category_id INTEGER + FK 있음 / idx_schedules_category_id 인덱스 있음
