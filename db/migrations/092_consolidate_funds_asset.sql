-- 092: 자금 단일화 — 비상금 제외 자산을 단일 '자금' 필드로 통합 (#539, ADR 0051)
--
-- 비상금을 제외한 자산을 단일 '자금'(현금 유동자금)으로 통합한다.
-- 입력 의미를 "통장 잔액 − 지난 결제 대금"(현금 유동자금) 하나로 단순화.
-- 비상금(is_emergency=true)은 예산 분배 밖 '최후의 보루'로 분리 보존.
-- distribute_to_runway 컬럼은 더 이상 읽지 않지만 데드 컬럼으로 보존(드롭하지 않음).
--
-- 적용 후: '자금' 값을 현금 유동자금 기준으로 1회 재입력해야 한다(수기 보정).

-- 1) 비상금이 아니고 기본 자산도 아니며 가용액이 0인 보조 자산 행 정리.
--    단일 자금으로 합치기 위한 빈 보조 행 제거. assets는 외래키 참조 대상이 아님(안전).
DELETE FROM assets
 WHERE COALESCE(is_emergency, false) = false
   AND COALESCE(is_default, false) = false
   AND COALESCE(available_amount, 0) = 0;

-- 2) 남은 기본(비상금 제외) 자산을 '자금'으로 명명 — 입력 의미 단일화.
UPDATE assets
   SET name = '자금', updated_at = NOW()
 WHERE COALESCE(is_emergency, false) = false
   AND COALESCE(is_default, false) = true;
