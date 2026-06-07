-- 079: 주간 가설 리포트 → 주간 패턴 검증 slot rename + 시각 조정 (#477 P2)
-- SLOT_TASKS 키를 weeklyHypothesisReview → weeklyVerification으로 바꾸므로 DB slot_name도 동기화.
-- (slot_name source of truth = notification_settings DB — 키와 어긋나면 스케줄 누락.)
--
-- 시각 08:00 → 06:00 월요일: 주간 엔진은 pattern_links를 SET 재계산하고 daily-insight(08:03,
-- #insight)가 accumulating tier(pattern_summary ← pattern_links)를 읽는다. 엔진 실행이 수 분
-- 걸릴 수 있어 08:03과 겹치면 부분 갱신 상태를 읽을 위험 → 2시간 앞당겨 레이스 제거.
-- (엔진은 raw 도메인 데이터를 TS로 재계산하므로 07:00 매칭 cron과는 무관.)

UPDATE notification_settings
   SET slot_name  = 'weeklyVerification',
       label      = '주간 패턴 검증',
       time_value = '06:00'
 WHERE slot_name = 'weeklyHypothesisReview';

DO $$
DECLARE
  got INT;
BEGIN
  SELECT count(*) INTO got FROM notification_settings WHERE slot_name = 'weeklyVerification';
  RAISE NOTICE '[079] weeklyVerification slot % 행 (06:00 월요일)', got;
END $$;
