-- Stage 4: 백업 테이블 DROP (1주 검증 완료 후)
--
-- 실행 전 확인:
--   - 마이그레이션 후 1주 이상 정상 동작
--   - Slack 봇 / 웹 / 크론 모두 새 스키마로 정상 작동
--   - 더이상 백업 테이블 참조할 일 없음
--
-- 한번 더 안전망: pg_dump 파일은 별도로 보관됨.

BEGIN;

DROP TABLE IF EXISTS schedules_backup_20260513;
DROP TABLE IF EXISTS categories_backup_20260513;

COMMIT;
