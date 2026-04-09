-- 수입 전체 기간 분배 옵션
-- distribute_to_budget=true: 이번 달에만 반영하지 않고 전체 목표 기간에 균등 분배
ALTER TABLE expenses
ADD COLUMN IF NOT EXISTS distribute_to_budget BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN expenses.distribute_to_budget
IS '수입을 이번 달에만 반영(false)할지 전체 기간에 분배(true)할지';
