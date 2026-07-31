-- 고정비 결제수단 미지정 행 백필 (#615 후속)
--
-- 109에서 fixed_costs.payment_method를 추가했지만 기존 행은 NULL로 남았다.
-- 런타임은 NULL을 기본 결제수단으로 폴백하므로 동작은 같지만, 설정 화면이
-- 폴백 값을 그대로 보여줘서 "미지정"과 "명시 지정"을 구분할 수 없었다.
-- 저장값과 표시값을 일치시키기 위해 폴백과 같은 값으로 한 번 채운다.
-- (기본 결제수단은 billing/payment-methods.ts의 DEFAULT_PAYMENT_METHOD와 같은 값)
UPDATE fixed_costs
SET payment_method = '현대카드'
WHERE payment_method IS NULL;
