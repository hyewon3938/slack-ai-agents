-- dev-cron 서버 코드 제거에 따른 DB 정리
-- Scheduled Task(nightly-dev-report)로 대체됨

-- dev_analyses 테이블 제거 (데이터 0건, 사용되지 않음)
DROP TABLE IF EXISTS dev_analyses;

-- notification_settings에서 dev 크론 슬롯 제거
DELETE FROM notification_settings WHERE slot_name IN ('devReview', 'workSummary');
