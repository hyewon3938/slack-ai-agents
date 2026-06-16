-- 093: 주간 리뷰 누락 fallback 알림 슬롯 (#542, ADR-0052)
-- routine(weekly-saju-review-v2, 월 08:04)이 통합 카드를 단독 발송. 미발송 주 침묵 방지(출력 연속성):
-- 봇이 월 10:00에 saju_weekly_reviews 발송 기록(week_start=이번주 월요일)을 확인 → 없으면
-- "수동 실행해줘" 알림만 발송(봇이 반쪽 카드를 대신 만들지 않음 — ADR-0052 Alt B 기각).
-- (slot_name source of truth = notification_settings — SLOT_TASKS 키와 어긋나면 스케줄 누락.)
-- 매일 등록되지만 weeklyReviewFallbackTask 내부에서 월요일만 실행(weeklyVerification과 동일 패턴).

INSERT INTO notification_settings (slot_name, time_value, label, active)
VALUES ('weeklyReviewFallback', '10:00', '주간 리뷰 누락 알림', true)
ON CONFLICT (slot_name) DO NOTHING;

DO $$
DECLARE
  got INT;
BEGIN
  SELECT count(*) INTO got FROM notification_settings WHERE slot_name = 'weeklyReviewFallback';
  RAISE NOTICE '[093] weeklyReviewFallback slot % 행 (월 10:00)', got;
END $$;
