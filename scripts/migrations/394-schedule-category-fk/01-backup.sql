-- Stage 0-1: DB 내부 백업 테이블 생성
-- pg_dump와 별개로, 빠른 롤백/대조용 백업 테이블을 DB 내부에 둔다.
-- 백업 테이블은 1주 검증 후 06-cleanup.sql로 DROP.

BEGIN;

-- 기존 백업 테이블이 있으면 안전을 위해 중단 (실수로 덮어쓰는 사고 방지)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'schedules_backup_20260513') THEN
    RAISE EXCEPTION 'schedules_backup_20260513 이미 존재. 날짜 변경 또는 기존 백업 정리 필요.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'categories_backup_20260513') THEN
    RAISE EXCEPTION 'categories_backup_20260513 이미 존재. 날짜 변경 또는 기존 백업 정리 필요.';
  END IF;
END $$;

CREATE TABLE schedules_backup_20260513 AS SELECT * FROM schedules;
CREATE TABLE categories_backup_20260513 AS SELECT * FROM categories;

COMMIT;

-- row count 일치 검증 (트랜잭션 외부 — 결과만 보면 됨)
SELECT
  (SELECT COUNT(*) FROM schedules) AS schedules_now,
  (SELECT COUNT(*) FROM schedules_backup_20260513) AS schedules_bak,
  (SELECT COUNT(*) FROM categories) AS categories_now,
  (SELECT COUNT(*) FROM categories_backup_20260513) AS categories_bak;
-- → schedules_now == schedules_bak AND categories_now == categories_bak 일치 확인
