-- 사용자 커스텀 지시사항 (Slack에서 설정, 시스템 프롬프트에 반영)
CREATE TABLE IF NOT EXISTS custom_instructions (
  id SERIAL PRIMARY KEY,
  instruction TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
