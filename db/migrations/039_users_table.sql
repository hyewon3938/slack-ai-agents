-- users 테이블: DB user_id ↔ Slack user ID 매핑
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  slack_user_id VARCHAR(20) UNIQUE,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 기존 user_id=1 데이터 보존 (slack_user_id는 배포 후 UPDATE로 설정)
INSERT INTO users (id, name) VALUES (1, '사용자1')
ON CONFLICT (id) DO NOTHING;

-- 시퀀스 보정 (기존 id와 충돌 방지)
SELECT setval('users_id_seq', (SELECT MAX(id) FROM users));
