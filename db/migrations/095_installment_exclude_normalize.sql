-- 095: 할부 exclude 플래그 정규화 — 할부는 항상 묶인 돈 (#549, #539/ADR 0051)
--
-- #539(ADR 0051) 계약: 할부 회차는 목표 기간 창 안에서 "묶인 돈"(reservation)이며
-- exclude_from_budget 토글은 일반(비할부) 지출 전용이다. #539에서 할부 exclude 토글을
-- 제거했지만 그 이전에 exclude=true로 기록된 기존 할부 행(미래 회차)은 정리하지 않아
-- 집계마다 이 플래그에 흔들렸다(요약 카드 "할부" 표시 ≠ 실제 락, 정산 스냅샷 분해 왜곡).
--
-- forward-only. UPDATE는 (is_installment=true AND exclude=true) 조합에만 국한한다.

-- 1) 정규화: 할부 행의 exclude 플래그 무효화 (할부는 예외 없이 묶인 돈).
UPDATE expenses
   SET exclude_from_budget = false
 WHERE COALESCE(is_installment, false) = true
   AND COALESCE(exclude_from_budget, false) = true;

-- 2) 재발 차단: 할부이면서 예산 제외인 조합을 제약으로 금지.
ALTER TABLE expenses
  ADD CONSTRAINT expenses_installment_not_excluded
  CHECK (NOT (COALESCE(is_installment, false) AND COALESCE(exclude_from_budget, false)));

DO $$
DECLARE
  leftover INT;
BEGIN
  SELECT count(*) INTO leftover FROM expenses
   WHERE COALESCE(is_installment, false) AND COALESCE(exclude_from_budget, false);
  RAISE NOTICE '[095] 정규화 후 할부 exclude 잔여 행 % (0이어야 정상)', leftover;
END $$;
