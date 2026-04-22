-- modify_db 확인 플로우용 대기 테이블.
-- LLM이 생성한 DELETE/UPDATE의 dry-run 영향 row가 임계치 이상이면
-- 이 테이블에 token과 함께 저장하고, Slack 확인 버튼 클릭 시 실제 실행한다.
CREATE TABLE IF NOT EXISTS pending_modify (
  id SERIAL PRIMARY KEY,
  token VARCHAR(16) UNIQUE NOT NULL,
  user_id INTEGER NOT NULL,
  sql_text TEXT NOT NULL,
  dry_run_row_count INTEGER NOT NULL,
  slack_channel VARCHAR(64),
  slack_thread_ts VARCHAR(32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  executed_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pending_modify_token ON pending_modify(token);
CREATE INDEX IF NOT EXISTS idx_pending_modify_pending
  ON pending_modify(expires_at)
  WHERE executed_at IS NULL AND canceled_at IS NULL;
