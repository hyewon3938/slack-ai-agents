-- Stage 0-3: 사전 매칭 검증
--
-- 04-migrate.sql 실행 전, 모든 schedule row가 categories 테이블의 row와 매칭되는지 확인.
-- 두 쿼리 모두 0행이 나와야 04-migrate.sql 진행 가능.
-- 0행이 아니면 02-recovery.sql 수정 또는 categories 정비 후 재실행.

-- (1) categories에 등록 안 된 category 텍스트
SELECT '미등록 category' AS issue,
       category AS value,
       COUNT(*) AS row_count
FROM schedules
WHERE category IS NOT NULL
  AND user_id = 1
  AND category NOT IN (SELECT name FROM categories WHERE user_id = 1)
GROUP BY category
ORDER BY row_count DESC;

-- (2) parent 매칭 안 되는 subcategory
-- subcategory가 있는데, 해당 parent(category)의 child로 등록 안 된 경우
SELECT '미등록 subcategory' AS issue,
       s.category AS parent_name,
       s.subcategory AS value,
       COUNT(*) AS row_count
FROM schedules s
WHERE s.subcategory IS NOT NULL
  AND s.user_id = 1
  AND NOT EXISTS (
    SELECT 1 FROM categories c
    JOIN categories p ON c.parent_id = p.id
    WHERE c.name = s.subcategory
      AND p.name = s.category
      AND c.user_id = s.user_id
  )
GROUP BY s.category, s.subcategory
ORDER BY row_count DESC;
