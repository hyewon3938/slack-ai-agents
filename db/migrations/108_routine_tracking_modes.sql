-- 108: 루틴 추적 모드 이원화 — 기대된 발생과 자발적 기록의 분리 (#605, 마스터 #604 Phase 1, ADR-0061)
-- 배경: routine_records의 한 행 = "그날 기대된 발생"이라는 암묵 계약 위에 달성률·연속 달성·패턴 신호가
--   서 있다. 템플릿의 빈도를 보고 크론이 그날 행을 미리 만들고 체크하면 completed를 켜므로, "그날 행 수"가
--   분모다. 주기 없이 수행할 때마다 남기는 자율 기록이 같은 테이블에 들어가면 그 분모 정의가 조용히 바뀐다.
--   모드는 정의(템플릿)에, 성격은 사실(기록)에 나눠 저장하고, 기대된 발생을 세는 신호 SQL의 측정 범위를
--   좁혀 기존 수치의 의미를 고정한다.
-- 안전: 기존 행은 전부 DEFAULT 'scheduled'를 받으므로 적용 직후 모든 수치가 불변.
--   ③은 방향·타입·도메인 불변, 측정 범위만 좁힘 — 100/101/107 전례(*무엇을* 측정하는지만 교정).
--   파일 전체가 단일 암묵 트랜잭션(migrate.ts) — ②·④의 RAISE 시 전체 롤백.
-- 주의: ②의 조건부 유니크 인덱스는 (user_id, template_id, date) 중복이 이미 있으면 실패한다. 이 테이블에는
--   지금까지 하루 1건 제약이 없었으므로 적용 전 중복 0건을 확인해야 한다(#605 계획서 §12, prod 확인 완료).
--   마이그레이션은 봇 부팅 시 적용되고 실패가 감싸이지 않으므로, 실패는 곧 기동 불가다.
-- 범위 밖(의도): routine_completion_rate에는 status='pending'(source='llm', direction='above_avg') 후보 행이
--   따로 있다. 이 교정은 active만 대상으로 한다 — pending은 승인 게이트를 통과할 때 사람이 sql_body를 보고
--   판단하는 대상이고, 그 시점의 규칙은 docs/domains/routine.md의 격리 규칙이 담당한다.
-- 멱등성: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / UPDATE 동일 결과 → 재실행 안전.

-- ═══ ① 추적 모드 축 + 기록 성격 스탬프 ═══════════════════════════════

ALTER TABLE routine_templates
  ADD COLUMN IF NOT EXISTS tracking_mode TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (tracking_mode IN ('scheduled', 'free'));

ALTER TABLE routine_records
  ADD COLUMN IF NOT EXISTS entry_type TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (entry_type IN ('scheduled', 'free'));

COMMENT ON COLUMN routine_templates.tracking_mode IS
  '추적 방식: scheduled=빈도대로 기대된 발생, free=수행 시점에만 기록. 변경 가능';
COMMENT ON COLUMN routine_records.entry_type IS
  '이 기록의 성격. 생성 시점에 확정되고 소급 변경하지 않음 (ADR-0061)';

-- ═══ ② 주기형 하루 1건 보장 (자율은 하루 여러 건 허용) ═══════════════

-- 사전 점검 — 중복이 있으면 raw unique_violation 대신 원인이 보이는 메시지로 중단
DO $$
DECLARE dup_groups int;
BEGIN
  SELECT COUNT(*) INTO dup_groups FROM (
    SELECT user_id, template_id, date
      FROM routine_records
     WHERE entry_type = 'scheduled'
     GROUP BY user_id, template_id, date
    HAVING COUNT(*) > 1
  ) d;
  IF dup_groups > 0 THEN
    RAISE EXCEPTION '[108②] 주기형 기록에 (user_id, template_id, date) 중복 % 조 — 인덱스 생성 불가. 중복 정리 후 재적용', dup_groups;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS routine_records_scheduled_daily_uniq
  ON routine_records (user_id, template_id, date)
  WHERE entry_type = 'scheduled';

-- ═══ ③ 루틴 신호 측정 범위 교정 (방향·타입·도메인 불변) ═══════════════
-- 052에서 심고 077이 signal_defs로 그대로 이관한 SQL. 자율 기록을 분모에서 제외한다.
-- status='active' 조건 필수 — 052가 routine_completion_rate를 두 번 심었고 085가 그중 한 행을
-- rejected 처리했다. rejected 행은 이력으로 남긴다.

UPDATE signal_defs
   SET sql_body = $sql$SELECT COALESCE(SUM(CASE WHEN completed THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0), 0) FROM routine_records WHERE user_id=$1 AND date=$2 AND entry_type='scheduled'$sql$
 WHERE user_id = 1 AND kind = 'sql' AND status = 'active' AND name = 'routine_completion_rate';

UPDATE signal_defs
   SET sql_body = $sql$SELECT COALESCE(SUM(CASE WHEN rr.completed THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0), 0) FROM routine_records rr JOIN routine_templates rt ON rt.id=rr.template_id WHERE rr.user_id=$1 AND rr.date=$2 AND rt.category='운동' AND rr.entry_type='scheduled'$sql$
 WHERE user_id = 1 AND kind = 'sql' AND status = 'active' AND name = 'routine_rate_운동';

-- ═══ ④ 자기검증 ═══════════════════════════════════════════════════

DO $$
DECLARE
  today       date := CURRENT_DATE;
  col_count   int;
  chk_count   int;
  idx_exists  boolean;
  fixed_count int;
  rec         record;
  smoke_val   numeric;
BEGIN
  SELECT COUNT(*) INTO col_count
    FROM information_schema.columns
   WHERE (table_name = 'routine_templates' AND column_name = 'tracking_mode')
      OR (table_name = 'routine_records'   AND column_name = 'entry_type');
  IF col_count <> 2 THEN
    RAISE EXCEPTION '[108④] 컬럼 신설 실패 — 기대 2개, 실제 %', col_count;
  END IF;

  SELECT COUNT(*) INTO chk_count
    FROM pg_constraint
   WHERE contype = 'c'
     AND (conrelid = 'routine_templates'::regclass AND pg_get_constraintdef(oid) LIKE '%tracking_mode%'
       OR conrelid = 'routine_records'::regclass   AND pg_get_constraintdef(oid) LIKE '%entry_type%');
  IF chk_count < 2 THEN
    RAISE EXCEPTION '[108④] CHECK 제약 누락 — 기대 2개 이상, 실제 %', chk_count;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'routine_records_scheduled_daily_uniq'
  ) INTO idx_exists;
  IF NOT idx_exists THEN
    RAISE EXCEPTION '[108④] 주기형 하루 1건 인덱스 없음';
  END IF;

  SELECT COUNT(*) INTO fixed_count
    FROM signal_defs
   WHERE user_id = 1 AND kind = 'sql' AND status = 'active'
     AND name IN ('routine_completion_rate', 'routine_rate_운동')
     AND sql_body LIKE '%entry_type%';
  IF fixed_count <> 2 THEN
    RAISE EXCEPTION '[108④] 신호 SQL 교정 누락 — entry_type 포함 기대 2건, 실제 %', fixed_count;
  END IF;

  -- 스모크: 교정된 sql_body를 실제로 실행해 좀비 신호(101 사고 클래스) 재발을 막는다
  FOR rec IN
    SELECT name, sql_body FROM signal_defs
     WHERE user_id = 1 AND kind = 'sql' AND status = 'active'
       AND name IN ('routine_completion_rate', 'routine_rate_운동')
  LOOP
    EXECUTE replace(replace(rec.sql_body, '$1', '1'), '$2', quote_literal(today)) INTO smoke_val;
    IF smoke_val IS NULL THEN
      RAISE EXCEPTION '[108④] 교정 SQL 스모크 실패 — % 가 NULL 반환(숫자 기대)', rec.name;
    END IF;
  END LOOP;

  RAISE NOTICE '[108④] 검증 통과 — 컬럼 2 / CHECK % / 주기형 하루 1건 인덱스 / 신호 교정 2건 스모크 OK', chk_count;
END $$;
