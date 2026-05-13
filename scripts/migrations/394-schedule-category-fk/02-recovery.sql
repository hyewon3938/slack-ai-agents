-- Stage 0-2: rename으로 끊긴 카테고리 데이터 복구
--
-- 카테고리 이름이 categories 테이블에서 변경됐지만, schedules.category는 TEXT라서
-- 옛 이름이 그대로 남아 있는 row를 현재 이름으로 갱신한다.
--
-- 카테고리 실명은 공개 텍스트(코드/이슈/PR)에 노출 금지 원칙이라 placeholder만 둠.
-- VM에서 이 파일을 직접 편집해서 <옛이름> / <현재이름>을 채워 실행.
--
-- 실행 전: 03-verify-prematch.sql을 미리 돌려서 어떤 매칭 실패가 있는지 확인 가능.

BEGIN;

-- 케이스 1
UPDATE schedules
SET category = '<현재 카테고리 이름 1>'
WHERE category = '<이전 카테고리 이름 1>'
  AND user_id = 1;
-- 영향 row 수 확인하고 의도와 일치하는지 검토

-- 케이스 2 (추가 rename 케이스 발생 시)
UPDATE schedules
SET category = '<현재 카테고리 이름 2>'
WHERE category = '<이전 카테고리 이름 2>'
  AND user_id = 1;

-- 추가 케이스 필요 시 같은 패턴으로 추가

-- subcategory도 rename됐다면 동일 패턴으로 처리
-- UPDATE schedules SET subcategory = '<현재>' WHERE subcategory = '<이전>' AND user_id = 1;

COMMIT;
