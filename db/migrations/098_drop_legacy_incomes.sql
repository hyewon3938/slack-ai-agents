-- 098: 레거시 incomes 테이블 정리 (#553, 2026-07 F9)
--
-- 수입은 expenses(type='income', billing_month) 단일 경로로 집계된다(#539/ADR 0051 이후).
-- 과거 병존하던 incomes 테이블은 신규 기록 경로가 사라져 빈 상태로 남아 있었고,
-- readIncomeTotal 의 UNION 한 축으로만 참조됐다(항상 0 기여). 코드에서 UNION 을 제거하면서
-- 테이블도 함께 정리한다.
--
-- forward-only. 빈 테이블만 DROP — 행이 남아 있으면 EXCEPTION 으로 중단(데이터 유실 방지).

DO $$
DECLARE
  cnt INT;
BEGIN
  IF to_regclass('public.incomes') IS NULL THEN
    RAISE NOTICE '[098] incomes 테이블 없음 → skip';
  ELSE
    EXECUTE 'SELECT count(*) FROM incomes' INTO cnt;
    IF cnt > 0 THEN
      RAISE EXCEPTION '[098] incomes 테이블에 % 행 존재 → DROP 중단 (빈 테이블만 정리)', cnt;
    END IF;
    EXECUTE 'DROP TABLE incomes';
    RAISE NOTICE '[098] 빈 incomes 테이블 DROP 완료';
  END IF;
END $$;
