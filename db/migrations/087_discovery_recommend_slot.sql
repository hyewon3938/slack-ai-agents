-- 087: 발굴 후보 재추천 데일리 슬롯 (#512 / #504 Phase 3, ADR-0047)
-- 묶음 전부 패스 시 다음 best 묶음을 데일리 틱(07:30)으로 재추천. weekly-verification(월 06:00)의
-- 발굴을 공유 함수로 재실행 — 예측 게이트(이번주 묶음 전부 archived & cap 미만) 통과 시에만.
-- (slot_name source of truth = notification_settings — SLOT_TASKS 키와 어긋나면 스케줄 누락.)

INSERT INTO notification_settings (slot_name, time_value, label, active)
VALUES ('discoveryRecommend', '07:30', '발굴 후보 재추천', true)
ON CONFLICT (slot_name) DO NOTHING;

DO $$
DECLARE
  got INT;
BEGIN
  SELECT count(*) INTO got FROM notification_settings WHERE slot_name = 'discoveryRecommend';
  RAISE NOTICE '[087] discoveryRecommend slot % 행 (07:30 데일리)', got;
END $$;
