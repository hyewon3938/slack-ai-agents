-- 039: slack_user_mappings에 유저별 수신 채널 매핑 컬럼 추가
-- 크론·주간 리포트 멀티유저 루프 확장 (#240)을 위한 선행 스키마.
-- 둘 다 nullable이며, NULL이면 slack_user_id로 DM 전송 폴백.

ALTER TABLE slack_user_mappings
  ADD COLUMN life_channel_id TEXT,
  ADD COLUMN insight_channel_id TEXT;
