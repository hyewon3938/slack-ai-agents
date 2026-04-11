-- 040: sleep_records 데이터 정합성 — 동일 수면 레코드 중복 방지
-- 동일 (user_id, date, sleep_type, bedtime) 조합으로 여러 건이 INSERT되는 것을
-- DB 레벨에서 차단한다. LLM의 실수나 네트워크 재시도로 같은 수면이 중복
-- 기록되는 리스크를 제거.
--
-- bedtime이 NULL인 레코드(메모 전용 INSERT)는 제외하여 메모만 기록하는
-- 사용 패턴은 그대로 허용한다.

CREATE UNIQUE INDEX IF NOT EXISTS uniq_sleep_records_user_date_type_bedtime
ON sleep_records (user_id, date, sleep_type, bedtime)
WHERE bedtime IS NOT NULL;
