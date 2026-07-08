-- 104: 월간 신호 제안 누락 fallback 알림 슬롯 (#466, ADR-0058)
-- routine(monthly-signal-suggest, 월 1일 09:30 repo 밖 SKILL)이 그 달 안 돌면 신호 제안 조용히 누락.
-- 봇이 월 2일 11:00에 signal_suggest_runs(월 클레임) row 존재를 확인 → 없으면 "수동 실행해줘" 알림만.
-- (row = 최초 클레임이라 발송 성공 아님. row 없음 = 그 달 미실행만 확실 감지 — ADR-0058/0053.)
-- (slot_name source of truth = notification_settings — SLOT_TASKS 키와 어긋나면 스케줄 누락.)
-- 매일 등록되지만 signalSuggestFallbackTask 내부에서 월 2일만 실행(weeklyReviewFallback 동일 패턴).

INSERT INTO notification_settings (slot_name, time_value, label, active)
VALUES ('signalSuggestFallback', '11:00', '월간 신호 제안 누락 알림', true)
ON CONFLICT (slot_name) DO NOTHING;

DO $$
DECLARE
  got INT;
BEGIN
  SELECT count(*) INTO got FROM notification_settings WHERE slot_name = 'signalSuggestFallback';
  RAISE NOTICE '[104] signalSuggestFallback slot % 행 (월 2일 11:00)', got;
END $$;
