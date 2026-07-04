-- 100: 일정 날짜 변경 신호 순변위 측정 + 기록 경로 트리거 단일화 (#572, ADR-0054)
-- 배경: #508(086, ADR-0046)이 날짜 변경 신호를 미룸/당김 방향 2개로 분리했으나 운영 데이터에서
--   측정 아티팩트 4종이 추가 확인됨 — ⓐ 왕복 상쇄 미처리(하루 안에 미뤘다 되돌리면 양쪽 발화,
--   당김 발화일 23% 오염) ⓑ 생성 직후 오기입 교정을 미룸/당김으로 집계 ⓒ 기록 경로 비대칭(웹만
--   기록, Slack 버튼·에이전트 SQL 누락) ⓓ CASCADE 이력 소급 소멸 + 존재-윈도우 어긋남.
-- 구성:
--   ① 스키마 — audit 로그화(FK 제거) + 생성시각 스냅샷 + change_type에 'deleted' 확장.
--   ② 기존 행 백필 — 스냅샷 컬럼을 살아있는 일정 created_at으로 채움.
--   ③ 기록 트리거 — schedules.date UPDATE 시 자동 기록(전 경로 단일 계기, 027 전례).
--   ③-b 삭제 tombstone 트리거 — AFTER DELETE 시 change_type='deleted' 행 기록(#574 코호트 기반).
--   ④ 신호 은퇴 + 신설 — 구 3개 rejected + 링크 archive → 같은 이름으로 순변위 정의 신설.
--   ⑤ 트리거 자기검증 DO 블록 — 기록·스냅샷·로그화 유지·tombstone 확인 + 테스트 행 정리.
--   ⑥ 일정 운명 view(schedule_fate) — 생성일 코호트 추적 기반(#574 선행).
--   ⑦ 카운트 검증 DO 블록.
-- 안전: 파일 전체가 단일 암묵 트랜잭션(migrate.ts) — 함수·트리거 DDL·검증 DO 블록이 RAISE 시 전체
--   롤백. 통계 스택·verdict·tier·임계치 불변 — #508과 동일하게 *무엇을* 측정하는지만 교정.
--   신설 신호는 시드(source='seed')라 signal-sql-guard(LLM 전용) 비대상.

-- ═══ ① 스키마 — audit 로그화(FK 제거) + 스냅샷 + change_type 확장 ═══
-- FK 제거: append-only 로그化 — 삭제 후에도 schedule_id 유지(SET NULL은 그룹핑 붕괴로 기각, ADR-0054 G).
-- FK constraint명은 053 자동 생성명이라 동적 조회로 DROP(하드코딩 금지). 053에는 FK가 2개
-- (user_id→users, schedule_id→schedules) — 로그화 대상은 schedules CASCADE만이므로 confrelid로
-- 특정한다. users FK는 유지(단일 사용자 시스템, 사용자 삭제 경로 없음 — user_id 정합은 계속 보장).
DO $$
DECLARE fk_name TEXT;
BEGIN
  SELECT conname INTO fk_name FROM pg_constraint
   WHERE conrelid = 'schedule_changes'::regclass AND contype = 'f'
     AND confrelid = 'schedules'::regclass;
  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE schedule_changes DROP CONSTRAINT %I', fk_name);
  END IF;
END $$;

-- 생성시각 스냅샷 컬럼 — 30분 유예 판정이 schedules JOIN 없이 자립(삭제 후에도 유효).
ALTER TABLE schedule_changes ADD COLUMN IF NOT EXISTS schedule_created_at TIMESTAMPTZ;
COMMENT ON COLUMN schedule_changes.schedule_created_at IS
  '기록 시점의 schedules.created_at 스냅샷 (#572 ADR-0054). 30분 유예 판정이 JOIN 없이 자립 — 일정 삭제 후에도 유효. 원문(제목 등)은 저장하지 않음(v2 헌장 ①).';

-- change_type CHECK에 'deleted' 추가(tombstone용). 기존 CHECK도 동적 조회 후 DROP → 재생성.
DO $$
DECLARE ck_name TEXT;
BEGIN
  SELECT conname INTO ck_name FROM pg_constraint
   WHERE conrelid = 'schedule_changes'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%change_type%';
  IF ck_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE schedule_changes DROP CONSTRAINT %I', ck_name);
  END IF;
END $$;

ALTER TABLE schedule_changes ADD CONSTRAINT schedule_changes_change_type_check
  CHECK (change_type IN ('date_changed','status_changed','category_changed','title_changed','memo_changed','deleted'));

COMMENT ON TABLE schedule_changes IS
  '일정 변경 audit — append-only 로그(#572 ADR-0054). writer=DB 트리거 단일 계기(record_schedule_date_change / record_schedule_deletion). schedule_id FK 없음(users FK는 유지) — 일정 삭제 후에도 schedule_id·이력 유지. 웹·Slack 버튼·에이전트 SQL·수동 psql 전 경로가 단일 계기로 수렴.';

-- ═══ ② 기존 행 백필 ═══════════════════════════════════════
-- 현행 CASCADE 하에서 잔존 행은 전부 살아있는 일정을 참조하므로 전량 백필됨.
UPDATE schedule_changes sc SET schedule_created_at = s.created_at
FROM schedules s WHERE s.id = sc.schedule_id AND sc.schedule_created_at IS NULL;

-- ═══ ③ 기록 트리거 — 전 경로 단일 계기 ═══════════════════
-- 027(schedules_updated_at 트리거) 전례 패턴. AFTER UPDATE OF date — date 외 컬럼 UPDATE에는
-- 트리거 자체가 안 걸림(027 updated_at 트리거와 공존, 실행 순서 무관).
CREATE OR REPLACE FUNCTION record_schedule_date_change() RETURNS trigger AS $$
BEGIN
  INSERT INTO schedule_changes
    (user_id, schedule_id, change_type, before_value, after_value, schedule_created_at)
  VALUES
    (NEW.user_id, NEW.id, 'date_changed',
     jsonb_build_object('date', OLD.date),
     jsonb_build_object('date', NEW.date),
     NEW.created_at);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- NEW.user_id IS NOT NULL 가드: schedules.user_id가 nullable(016)이라 NOT NULL 컬럼 INSERT 실패로
-- 본 UPDATE까지 중단되는 사고 방지. NULL date(백로그)는 {"date": null} — 신호 SQL이 NULL 필터로 제외.
DROP TRIGGER IF EXISTS schedules_date_audit ON schedules;
CREATE TRIGGER schedules_date_audit
  AFTER UPDATE OF date ON schedules
  FOR EACH ROW
  WHEN (OLD.date IS DISTINCT FROM NEW.date AND NEW.user_id IS NOT NULL)
  EXECUTE FUNCTION record_schedule_date_change();

-- ═══ ③-b 삭제 tombstone 트리거 (#574 코호트 기반) ═══════════
-- FK가 없으므로 AFTER DELETE에서 OLD.id 참조 INSERT가 안전(FK 유지였다면 부모 소멸로 위반).
-- before_value는 {date, status, category_id}만 — 제목 등 원문 비저장(v2 헌장 ①). 삭제 시점 status로
-- "done 후 정리 삭제"와 "todo 채 포기 삭제"를 구분 가능. 순변위 신호 SQL은 change_type='date_changed'
-- 필터라 tombstone 무영향.
CREATE OR REPLACE FUNCTION record_schedule_deletion() RETURNS trigger AS $$
BEGIN
  INSERT INTO schedule_changes
    (user_id, schedule_id, change_type, before_value, after_value, schedule_created_at)
  VALUES
    (OLD.user_id, OLD.id, 'deleted',
     jsonb_build_object('date', OLD.date, 'status', OLD.status, 'category_id', OLD.category_id),
     NULL,
     OLD.created_at);
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS schedules_delete_audit ON schedules;
CREATE TRIGGER schedules_delete_audit
  AFTER DELETE ON schedules
  FOR EACH ROW
  WHEN (OLD.user_id IS NOT NULL)
  EXECUTE FUNCTION record_schedule_deletion();

-- ═══ ④ 신호 은퇴 + 신설 (086 §① 패턴) ═══════════════════
-- 구 3개 status='rejected' + 링크 archive → 같은 이름으로 신설. 085/099 부분 유니크 인덱스는
-- active/pending만 잡으므로 은퇴를 신설보다 먼저 실행(그래야 신설이 인덱스에 안 걸림).
-- 이름 재사용 근거: SIGNAL_LABEL_OVERRIDES(insight-labels.ts)·테스트가 name 키라 무수정, 발굴·
-- findEquivalentSignal은 active/pending만 보므로 rejected 구 row와 무충돌.
UPDATE signal_defs SET status = 'rejected'
 WHERE user_id = 1 AND status = 'active'
   AND name IN ('audit_date_postponed', 'audit_date_advanced', 'audit_postponed_done');

-- 링크 archive: 방금 rejected로 내린 row만 잡도록 status='rejected' 조건 유지(구 audit_date_changed는
-- 이미 rejected+archived — 재-archive해도 무해하지만 검증 카운트에 영향 없게).
UPDATE pattern_links SET status = 'archived', updated_at = NOW()
 WHERE status IN ('active', 'pending', 'weak', 'confirmed')
   AND signal_id IN (SELECT id FROM signal_defs
                      WHERE user_id = 1 AND status = 'rejected'
                        AND name IN ('audit_date_postponed', 'audit_date_advanced', 'audit_postponed_done'));

-- audit_date_postponed: (일정×하루) 순변위 > 0 — 그날 그 일정의 첫 before < 마지막 after인 일정 수.
-- 왕복(순변위 0)은 제외, 생성 30분 유예(052 전례), 여러 번 나눠 미뤄도 하루 1회로 정규화.
INSERT INTO signal_defs (user_id, name, kind, sql_body, value_type, direction, threshold, domain, description, source, status)
VALUES (1, 'audit_date_postponed', 'sql',
  $sql$SELECT COUNT(*) FROM (
  SELECT schedule_id,
         (array_agg((before_value->>'date')::date ORDER BY changed_at ASC))[1]  AS first_b,
         (array_agg((after_value->>'date')::date ORDER BY changed_at DESC))[1] AS last_a
  FROM schedule_changes
  WHERE user_id=$1 AND change_type='date_changed'
    AND DATE(changed_at AT TIME ZONE 'Asia/Seoul')=$2
    AND before_value->>'date' IS NOT NULL AND after_value->>'date' IS NOT NULL
    AND (schedule_created_at IS NULL OR changed_at > schedule_created_at + INTERVAL '30 minutes')
  GROUP BY schedule_id
) g WHERE last_a > first_b$sql$,
  'continuous', 'above_abs', 1, 'audit',
  '일정을 순변위 기준으로 뒤로 미룬 날 (왕복 상쇄, 생성 30분 유예)', 'seed', 'active')
ON CONFLICT DO NOTHING;

-- audit_date_advanced: 동일 구조, 순변위 < 0(당김).
INSERT INTO signal_defs (user_id, name, kind, sql_body, value_type, direction, threshold, domain, description, source, status)
VALUES (1, 'audit_date_advanced', 'sql',
  $sql$SELECT COUNT(*) FROM (
  SELECT schedule_id,
         (array_agg((before_value->>'date')::date ORDER BY changed_at ASC))[1]  AS first_b,
         (array_agg((after_value->>'date')::date ORDER BY changed_at DESC))[1] AS last_a
  FROM schedule_changes
  WHERE user_id=$1 AND change_type='date_changed'
    AND DATE(changed_at AT TIME ZONE 'Asia/Seoul')=$2
    AND before_value->>'date' IS NOT NULL AND after_value->>'date' IS NOT NULL
    AND (schedule_created_at IS NULL OR changed_at > schedule_created_at + INTERVAL '30 minutes')
  GROUP BY schedule_id
) g WHERE last_a < first_b$sql$,
  'continuous', 'above_abs', 1, 'audit',
  '일정을 순변위 기준으로 앞으로 당긴 날 (왕복 상쇄, 생성 30분 유예)', 'seed', 'active')
ON CONFLICT DO NOTHING;

-- audit_postponed_done: 순미룸 일수 ≥ 2인 일정을 완료한 날. 자격을 raw 변경 횟수(방향 무시)에서
-- 순미룸 일수로 재정의 — 왕복 1회(=2행)만으로 자격이 생기던 인플레 제거.
INSERT INTO signal_defs (user_id, name, kind, sql_body, value_type, direction, threshold, domain, description, source, status)
VALUES (1, 'audit_postponed_done', 'sql',
  $sql$WITH pd AS (
  SELECT schedule_id, DATE(changed_at AT TIME ZONE 'Asia/Seoul') AS day,
         (array_agg((before_value->>'date')::date ORDER BY changed_at ASC))[1]  AS first_b,
         (array_agg((after_value->>'date')::date ORDER BY changed_at DESC))[1] AS last_a
  FROM schedule_changes
  WHERE user_id=$1 AND change_type='date_changed'
    AND before_value->>'date' IS NOT NULL AND after_value->>'date' IS NOT NULL
    AND (schedule_created_at IS NULL OR changed_at > schedule_created_at + INTERVAL '30 minutes')
  GROUP BY schedule_id, DATE(changed_at AT TIME ZONE 'Asia/Seoul')
), rc AS (
  SELECT schedule_id, COUNT(*) AS n FROM pd WHERE last_a > first_b GROUP BY schedule_id
)
SELECT COUNT(*) FROM schedules s JOIN rc ON rc.schedule_id = s.id
WHERE s.user_id=$1 AND s.date=$2 AND s.status='done' AND rc.n >= 2$sql$,
  'continuous', 'above_abs', 1, 'audit',
  '순미룸 일수 2일 이상인 일정을 완료한 날 (왕복 상쇄, 생성 30분 유예)', 'seed', 'active')
ON CONFLICT DO NOTHING;

-- ④ 검증
DO $$
DECLARE
  new_active INT;
  old_rejected INT;
BEGIN
  SELECT count(*) INTO new_active FROM signal_defs
   WHERE user_id = 1 AND status = 'active'
     AND name IN ('audit_date_postponed', 'audit_date_advanced', 'audit_postponed_done');
  IF new_active <> 3 THEN
    RAISE EXCEPTION '[100④] 순변위 신호 3개 신설 실패 — active %', new_active;
  END IF;
  SELECT count(*) INTO old_rejected FROM signal_defs
   WHERE user_id = 1 AND status = 'rejected'
     AND name IN ('audit_date_postponed', 'audit_date_advanced', 'audit_postponed_done');
  IF old_rejected < 3 THEN
    RAISE EXCEPTION '[100④] 구 신호 은퇴 실패 — rejected %', old_rejected;
  END IF;
  RAISE NOTICE '[100④] 순변위 재정의 완료 — 구 3신호 은퇴, 신설 3신호 active';
END $$;

-- ═══ ⑤ 트리거 자기검증 DO 블록 ═══════════════════════════
-- 임시 일정 INSERT → date UPDATE → audit 행·스냅샷 확인 → 임시 일정 DELETE →
-- date_changed 행의 schedule_id 유지 확인(로그화) + tombstone 행 확인 →
-- 테스트 audit 행 전부 DELETE(FK가 없어 자동 정리 안 됨 — 남기면 그날 미룸/삭제 신호 오염).
DO $$
DECLARE
  tmp_id INT; audit_id INT; audit_created TIMESTAMPTZ; audit_sched INT; tomb_id INT;
BEGIN
  INSERT INTO schedules (user_id, title, date) VALUES (1, '__migration_100_selftest__', '2000-01-01')
    RETURNING id INTO tmp_id;
  UPDATE schedules SET date = '2000-01-02' WHERE id = tmp_id;
  SELECT id, schedule_created_at INTO audit_id, audit_created
    FROM schedule_changes WHERE schedule_id = tmp_id AND change_type='date_changed';
  IF audit_id IS NULL THEN RAISE EXCEPTION '[100⑤] date 트리거 기록 실패'; END IF;
  IF audit_created IS NULL THEN RAISE EXCEPTION '[100⑤] 생성시각 스냅샷 누락'; END IF;
  DELETE FROM schedules WHERE id = tmp_id;
  SELECT schedule_id INTO audit_sched FROM schedule_changes WHERE id = audit_id;
  IF audit_sched IS DISTINCT FROM tmp_id THEN RAISE EXCEPTION '[100⑤] 로그화 실패 — 삭제 후 schedule_id 미유지'; END IF;
  SELECT id INTO tomb_id FROM schedule_changes WHERE schedule_id = tmp_id AND change_type='deleted';
  IF tomb_id IS NULL THEN RAISE EXCEPTION '[100⑤] 삭제 tombstone 미기록'; END IF;
  DELETE FROM schedule_changes WHERE id IN (audit_id, tomb_id);
  RAISE NOTICE '[100⑤] 트리거 2종·로그화·tombstone 자기검증 OK';
END $$;

-- ═══ ⑥ 일정 운명 view — 생성일 코호트 추적 기반 (#574 선행) ═══
-- 살아있는 일정(한 번도 안 옮긴 것 포함 = "잘 해결된" 쪽) + 삭제 일정(tombstone) 합집합 — 생존 편향 방지.
-- cohort_date(생성일)로 그루핑하면 "특정 날 만든 일정들의 운명"이 바로 나옴 — #574 이전에도 ad-hoc·주간
-- 리뷰 소비 가능. 배포 전 삭제분은 소급 불가(2026-07 이후 축적).
CREATE OR REPLACE VIEW schedule_fate AS
WITH postpones AS (
  -- (일정×하루) 순변위 미룸 일수 — 신호 SQL과 동일 의미론 (30분 유예 포함).
  SELECT schedule_id, COUNT(*) AS net_postpone_days
  FROM (
    SELECT schedule_id, DATE(changed_at AT TIME ZONE 'Asia/Seoul') AS day,
           (array_agg((before_value->>'date')::date ORDER BY changed_at ASC))[1]  AS first_b,
           (array_agg((after_value->>'date')::date ORDER BY changed_at DESC))[1] AS last_a
    FROM schedule_changes
    WHERE change_type='date_changed'
      AND before_value->>'date' IS NOT NULL AND after_value->>'date' IS NOT NULL
      AND (schedule_created_at IS NULL OR changed_at > schedule_created_at + INTERVAL '30 minutes')
    GROUP BY schedule_id, DATE(changed_at AT TIME ZONE 'Asia/Seoul')
  ) g WHERE last_a > first_b GROUP BY schedule_id
), tombstones AS (
  SELECT schedule_id, user_id, schedule_created_at,
         (before_value->>'category_id')::int AS category_id,
         before_value->>'status' AS status_at_deletion,
         changed_at AS deleted_at
  FROM schedule_changes WHERE change_type='deleted'
)
SELECT s.user_id, s.id AS schedule_id,
       DATE(s.created_at AT TIME ZONE 'Asia/Seoul') AS cohort_date,
       s.category_id, s.status AS final_status, false AS is_deleted,
       NULL::timestamptz AS deleted_at,
       COALESCE(p.net_postpone_days, 0) AS net_postpone_days
FROM schedules s LEFT JOIN postpones p ON p.schedule_id = s.id
UNION ALL
SELECT t.user_id, t.schedule_id,
       DATE(t.schedule_created_at AT TIME ZONE 'Asia/Seoul') AS cohort_date,
       t.category_id, t.status_at_deletion AS final_status, true AS is_deleted,
       t.deleted_at,
       COALESCE(p.net_postpone_days, 0) AS net_postpone_days
FROM tombstones t LEFT JOIN postpones p ON p.schedule_id = t.schedule_id;

COMMENT ON VIEW schedule_fate IS
  '일정 단위 궤적 — 생성일(KST cohort_date) 코호트 추적 기반 (#572 ADR-0054, #574 선행). 살아있는 일정(schedules) + 삭제 일정(tombstone) 합집합으로 생존 편향 방지 — 한 번도 안 옮긴 채 완료된 일정도 "잘 해결된" 쪽으로 포함. net_postpone_days는 (일정×하루) 순변위 미룸 일수. 코호트 신호 정의·성숙 기간·e-value 정합은 #574에서 설계.';

-- ═══ ⑦ 카운트 검증 DO 블록 (086 스타일) ═══════════════════
DO $$
DECLARE
  new_active INT;
  old_rejected INT;
  audit_active_links INT;
  null_snapshot INT;
  view_exists INT;
BEGIN
  SELECT count(*) INTO new_active FROM signal_defs
   WHERE user_id = 1 AND status = 'active'
     AND name IN ('audit_date_postponed', 'audit_date_advanced', 'audit_postponed_done');
  IF new_active <> 3 THEN
    RAISE EXCEPTION '[100⑦] 신설 신호 active 수 이상 — % (기대 3)', new_active;
  END IF;

  SELECT count(*) INTO old_rejected FROM signal_defs
   WHERE user_id = 1 AND status = 'rejected'
     AND name IN ('audit_date_postponed', 'audit_date_advanced', 'audit_postponed_done');
  IF old_rejected < 3 THEN
    RAISE EXCEPTION '[100⑦] 구 신호 rejected 수 이상 — % (기대 ≥ 3)', old_rejected;
  END IF;

  -- 은퇴 audit 신호에 살아있는 링크(active/pending/weak/confirmed)가 남아있으면 안 됨(전부 archive됨).
  SELECT count(*) INTO audit_active_links
    FROM pattern_links pl JOIN signal_defs s ON s.id = pl.signal_id
   WHERE s.domain = 'audit' AND s.status = 'rejected'
     AND pl.status IN ('active', 'pending', 'weak', 'confirmed');
  IF audit_active_links <> 0 THEN
    RAISE EXCEPTION '[100⑦] 은퇴 audit 신호를 가리키는 미정리 링크 % 건', audit_active_links;
  END IF;

  -- 백필 불변식: 살아있는 일정(created_at 있음)을 참조하는 행에 스냅샷 누락이 없어야 함.
  -- 전체 NULL 0 강제는 과잉 — schedules.created_at이 nullable(001)이라 생성시각 미상 행이 정상
  -- 존재할 수 있고, 그 경우 신호 SQL이 NULL 유예-면제로 이미 처리(부팅 롤백 사유가 아님).
  SELECT count(*) INTO null_snapshot
    FROM schedule_changes sc JOIN schedules s ON s.id = sc.schedule_id
   WHERE sc.schedule_created_at IS NULL AND s.created_at IS NOT NULL;
  IF null_snapshot <> 0 THEN
    RAISE EXCEPTION '[100⑦] 스냅샷 백필 누락 — schedule_created_at NULL % 건', null_snapshot;
  END IF;

  -- schedule_fate view 존재 확인.
  SELECT count(*) INTO view_exists FROM pg_views WHERE viewname = 'schedule_fate';
  IF view_exists <> 1 THEN
    RAISE EXCEPTION '[100⑦] schedule_fate view 미생성';
  END IF;

  RAISE NOTICE '[100⑦] 정합 검증 완료 — 신설 3 active / 구 3 rejected / audit active 링크 0 / 스냅샷 백필 완료 / view 존재';
END $$;
