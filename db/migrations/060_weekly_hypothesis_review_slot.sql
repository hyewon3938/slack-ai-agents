-- ADR-0019 Phase 4: 주간 가설 리포트 cron 슬롯 시드.
-- 매일 08:00 발송되지만 cron 본체가 월요일 외 return — weeklyReport와 동일 패턴.

INSERT INTO notification_settings (slot_name, time_value, label, active)
VALUES ('weeklyHypothesisReview', '08:00', '주간 가설 리포트', true)
ON CONFLICT (slot_name) DO NOTHING;
