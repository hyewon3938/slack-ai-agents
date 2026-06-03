-- 076: 일일 종합 인사이트 (#475)
-- A. daily_insight_log — 종합 인사이트 발송 멱등 로그 (routine 중복 실행 시 재발송 차단)
-- B. 파이프라인 순서 정렬: 매칭(dailySajuMatching)을 08:00 종합보다 선행하도록 07:00으로 당김
-- C. 구 insightMorning cron 비활성화 — 일운 포맷 알림을 daily-insight routine으로 이관 (ADR-0031)

-- A. 발송 멱등 로그
CREATE TABLE IF NOT EXISTS daily_insight_log (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  date       DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, date)
);

COMMENT ON TABLE daily_insight_log IS
  '일일 종합 인사이트(daily-insight routine) 발송 멱등 로그. (user_id, date) UNIQUE — 같은 날 재실행 시 INSERT ... ON CONFLICT DO NOTHING으로 중복 발송 차단.';

-- B. 매칭 선행 (08:00 종합이 그날 발현 시드를 읽도록 07:00으로)
UPDATE notification_settings SET time_value = '07:00' WHERE slot_name = 'dailySajuMatching';

-- C. 구 insightMorning cron 비활성화 (routine 이관). SLOT_TASKS 매핑도 코드에서 제거됨.
UPDATE notification_settings SET active = false WHERE slot_name = 'insightMorning';
