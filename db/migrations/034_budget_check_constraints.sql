-- 금액 양수 제약조건 추가
ALTER TABLE expenses ADD CONSTRAINT chk_expenses_amount CHECK (amount > 0);
ALTER TABLE planned_expenses ADD CONSTRAINT chk_planned_amount CHECK (amount > 0);
ALTER TABLE fixed_costs ADD CONSTRAINT chk_fixed_amount CHECK (amount > 0);
