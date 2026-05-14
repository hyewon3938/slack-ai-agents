-- 046: assets.is_default — 자동 차감 우선순위 자산 표시
-- 결제주기 종료 cron / 할부 미래 회차 INSERT 시 자산이 자동으로 차감될 때
-- 우선순위가 가장 높은 자산을 가리킨다. user당 최대 1개 (partial unique index).
-- 부족분은 is_emergency=false인 다른 자산으로 fallback.

ALTER TABLE assets ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS assets_user_default_unique
  ON assets (user_id)
  WHERE is_default = true;
