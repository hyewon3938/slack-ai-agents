-- 097: 은퇴 크론 슬롯 행 비활성 (#556)
-- pillarLevelDistributionReview는 #508(ADR-0046)에서 은퇴 — 누적 시드 강도 밴드 위임으로 분포 리뷰
-- 무의미해져 핸들러(SLOT_TASKS)에서 제거됨. loadAndSchedule는 미등록 슬롯을 graceful skip(taskFn 없으면
-- continue)하므로 DB row가 active로 남아도 무해하나, 설정 잔재라 비활성으로 정리(가역 — 단일 행 UPDATE).

UPDATE notification_settings SET active = false
 WHERE slot_name = 'pillarLevelDistributionReview';

DO $$
DECLARE
  got INT;
BEGIN
  SELECT count(*) INTO got FROM notification_settings
   WHERE slot_name = 'pillarLevelDistributionReview' AND active = false;
  RAISE NOTICE '[097] pillarLevelDistributionReview 비활성 % 행', got;
END $$;
