-- Rollback: 마이그레이션 후 문제 발견 시
--
-- 04-migrate.sql이 COMMIT까지 갔는데 사후에 문제가 발견된 경우 사용.
-- 코드 배포 전이라면 코드는 영향 없음. 코드 배포 후라면 코드도 함께 롤백 필요.
--
-- 옵션 A (권장): 백업 테이블에서 통째로 복원
-- 옵션 B: pg_dump 파일에서 psql -f 로 복원

-- ─── 옵션 A: 백업 테이블 → schedules 복원 ──────────────────

BEGIN;

-- 1) FK 제약 제거
ALTER TABLE schedules DROP CONSTRAINT IF EXISTS fk_schedules_category;
DROP INDEX IF EXISTS idx_schedules_category_id;

-- 2) 현재 테이블 제거
DROP TABLE schedules;

-- 3) 백업 테이블을 이름 변경
ALTER TABLE schedules_backup_20260513 RENAME TO schedules;

-- 4) PK / 시퀀스 등 재설정 (필요 시)
--    백업 테이블은 CREATE TABLE AS이므로 PK/시퀀스가 빠져 있을 수 있음.
--    수동 확인 후:
--    ALTER TABLE schedules ADD PRIMARY KEY (id);
--    SELECT setval('schedules_id_seq', (SELECT MAX(id) FROM schedules));

COMMIT;

-- ─── 옵션 B: pg_dump 파일 복원 (별도 셸에서) ──────────────────
--
-- # VM에서
-- docker exec -i slack-ai-agents-db psql -U "$DB_USER" -d "$DB_NAME" \
--   < "$HOME/backup_pre_category_migration_YYYYMMDD_HHMM.sql"
--
-- 단, 마이그레이션 후 새 데이터가 들어왔다면 그 데이터는 잃음.
