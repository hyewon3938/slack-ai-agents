-- 041: monthly_budget_snapshots — 월별 예산 배정/정산 기록
-- 대금기간 경계(매월 15일) 시점에 그 월의 배정 예산 + 실제 사용 + 가용자금
-- 스냅샷을 저장한다. 과거 월 불변성을 보장하기 위한 테이블.
-- Cron이 매일 자정에 체크하여 어제가 15일이면 idempotent하게 저장 (Phase 4).

CREATE TABLE IF NOT EXISTS monthly_budget_snapshots (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  year_month VARCHAR(7) NOT NULL,         -- '2026-04' (빌링 월)
  allocated_budget INTEGER NOT NULL,      -- 배정된 자유 예산
  fixed_total INTEGER NOT NULL,           -- 고정비 합계
  installment_total INTEGER NOT NULL,     -- 할부 합계
  planned_total INTEGER NOT NULL,         -- 예정 지출 합계
  flexible_spent INTEGER NOT NULL,        -- 실제 자유 지출
  excluded_spent INTEGER NOT NULL,        -- 예산 제외 지출
  income_total INTEGER NOT NULL,          -- 수입 합계
  available_at_start INTEGER NOT NULL,    -- 월 시작 시점 가용자금
  available_at_end INTEGER NOT NULL,      -- 월 종료 시점 가용자금
  sealed_at TIMESTAMPTZ NOT NULL,         -- 정산 시각
  UNIQUE(user_id, year_month)
);
