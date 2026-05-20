-- 현대카드 대금기간 14일 → 15일 변경에 따른 expenses.billing_month 재계산
-- (시스템 기본/현금/미등록 결제수단도 현대카드 기준이라 같이 적용)
--
-- 변경 전: 14일 이상이면 다음 달 대금
-- 변경 후: 15일 이상이면 다음 달 대금
--
-- 대상: 5월달 대금까지(date <= 2026-05-14)의 매월 14일 지출 중 결제수단이 '국민카드'가 아닌 것
-- 동작: 다음 달로 잘못 저장된 billing_month를 현재 달로 이동
-- 비대상: monthly_budget_snapshots (지난 사이클 정산은 종료, 재계산 안 함)
-- 안전장치: billing_month가 이미 현재 달인 경우(수동 입력 등)는 건드리지 않음

UPDATE expenses
SET billing_month = TO_CHAR(date, 'YYYY-MM')
WHERE EXTRACT(DAY FROM date) = 14
  AND date <= DATE '2026-05-14'
  AND (payment_method IS NULL OR payment_method <> '국민카드')
  AND billing_month = TO_CHAR(date + INTERVAL '1 month', 'YYYY-MM');
