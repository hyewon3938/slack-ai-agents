-- 실행 완료 후 "변경된 데이터의 현재 상태"를 다시 보여주려면
-- 어떤 테이블이 영향받는지 알아야 한다. sql_text 파싱 대신 컬럼으로 저장.
-- 기존 row는 NULL로 남지만 TTL 5분으로 곧 만료되므로 backfill 불필요.
ALTER TABLE pending_modify
  ADD COLUMN IF NOT EXISTS table_name VARCHAR(64);
