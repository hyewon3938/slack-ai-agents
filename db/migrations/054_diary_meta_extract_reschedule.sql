-- 054: 일기 메타 추출 cron 시간 조정 (23:50 → 05:30, 어제 일기 대상)
--
-- 배경:
--   23:50 시점에 일기를 아직 작성 중인 경우(또는 자정 넘어 작성)
--   추출이 누락된다. 익일 새벽 5:30에 어제 일기를 추출하면
--   하루치 일기가 모두 누적된 뒤 안전하게 처리 가능.
--   task 본체도 getEffectiveTodayISO() → getYesterdayISO() 로 변경됨
--   (src/cron/diary-meta-extract.ts).

UPDATE notification_settings
SET time_value = '05:30',
    label = '일기 메타 태그 추출 (어제 일기)'
WHERE slot_name = 'diaryMetaExtract';
