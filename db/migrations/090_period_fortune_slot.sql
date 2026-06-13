-- 090: 주기 운세 리포트 데일리 슬롯 — periodFortune (#529 / #523 Phase 2, 087 패턴)
-- 매일 08:20 틱에서 절기 전환·입춘·대운 전환을 감지해 월운/세운/대운 카드를 #insight로 발송.
-- 전환 없는 날은 no-op. (slot_name source of truth = notification_settings — SLOT_TASKS 키와 어긋나면 누락.)
-- 08:20: daily-insight SKILL(08:03, repo 밖) · discoveryRecommend(07:30) 충돌 회피.
--   prod 슬롯 점검(2026-06-13): 08:20 미사용 확인(인접 insightMorning 08:00·sleepCheck 08:50 모두 inactive).

INSERT INTO notification_settings (slot_name, time_value, label, active)
VALUES ('periodFortune', '08:20', '주기 운세 리포트', true)
ON CONFLICT (slot_name) DO NOTHING;

DO $$
DECLARE
  got INT;
BEGIN
  SELECT count(*) INTO got FROM notification_settings WHERE slot_name = 'periodFortune';
  RAISE NOTICE '[090] periodFortune slot % 행 (08:20 데일리)', got;
END $$;
