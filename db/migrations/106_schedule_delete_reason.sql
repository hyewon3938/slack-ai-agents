-- 106: 일정 삭제 사유 수집 — tombstone 사유 컬럼 + 시드 신호 (#590, ADR-0060)
-- 배경: 100(ADR-0054)이 삭제를 tombstone(change_type='deleted')으로 전 경로 캡처하지만 "왜"가 없음.
--   삭제 사유는 일정 취소 행동을 해석하는 메타데이터 — 고정 어휘 5종 + 자유 텍스트로 수집해
--   검증 파이프라인(P5a 발굴·주간 검증)의 입력으로 편입한다.
-- 기록 규약(ADR-0060): tombstone 행 생성은 트리거 단일 계기 그대로(ADR-0054 불변).
--   사유는 삭제 직후 앱(웹 DELETE API·에이전트 SQL)이 fill-NULL-only UPDATE로 1회 enrichment —
--   append-only 로그에 허용하는 유일한 예외이며 트리거가 쓴 필드는 불변.
-- 원칙: delete_reason_text는 사용자 원문 → 검증·발굴·제안 LLM 입력 금지(v2 헌장 ①).
--   신호화는 delete_reason_category만. LLM 신호 SQL의 원문 컬럼 참조는 signal-sql-guard가 정적 차단.
-- 구성:
--   ① 스키마 — 사유 컬럼 2개 + CHECK 2개(어휘 고정, deleted 행 한정) + 테이블 COMMENT 갱신.
--   ② 시드 신호 신설 — audit_cancel_changed_mind (변심 삭제 발생일, source='seed'라 승인 게이트 비대상).
--   ③ schedule_fate view 재생성 — 말미에 delete_reason_category 노출(#574 코호트 레이어가 사유 슬라이스 가능).
--   ④ 자기검증 DO 블록 — tombstone → enrichment → CHECK 거부 → fate 노출 확인 + 테스트 행 정리.
--   ⑤ 정합 검증 DO 블록.
-- 안전: 파일 전체가 단일 암묵 트랜잭션(migrate.ts) — 검증 DO 블록 RAISE 시 전체 롤백. 재실행 idempotent.
--   105는 진행 중인 다른 브랜치가 선점 — 096 결번 전례대로 번호 갭 무해(러너는 파일명 순 미적용분 실행).

-- ═══ ① 스키마 — 사유 컬럼 + CHECK + COMMENT ═══════════════
ALTER TABLE schedule_changes ADD COLUMN IF NOT EXISTS delete_reason_category TEXT;
ALTER TABLE schedule_changes ADD COLUMN IF NOT EXISTS delete_reason_text TEXT;

COMMENT ON COLUMN schedule_changes.delete_reason_category IS
  '삭제 사유 고정 어휘 (#590 ADR-0060): mistake(실수 생성)|changed_mind(변심·하기 싫음)|external(상대방·외부 사정)|rescheduled(다른 일정으로 대체)|other(기타). deleted 행 한정. 웹 delete-reasons.ts와 동기.';
COMMENT ON COLUMN schedule_changes.delete_reason_text IS
  '삭제 사유 자유 텍스트 (#590 ADR-0060). 사용자 원문이므로 검증·발굴·제안 LLM 입력 금지(v2 헌장 ①) — 신호화는 category만. deleted 행 한정.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'schedule_changes'::regclass
                    AND conname = 'schedule_changes_delete_reason_category_check') THEN
    ALTER TABLE schedule_changes ADD CONSTRAINT schedule_changes_delete_reason_category_check
      CHECK (delete_reason_category IS NULL
             OR (change_type = 'deleted'
                 AND delete_reason_category IN ('mistake','changed_mind','external','rescheduled','other')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'schedule_changes'::regclass
                    AND conname = 'schedule_changes_delete_reason_text_check') THEN
    ALTER TABLE schedule_changes ADD CONSTRAINT schedule_changes_delete_reason_text_check
      CHECK (delete_reason_text IS NULL OR change_type = 'deleted');
  END IF;
END $$;

-- 기록 주체 규약 갱신 — 행 생성은 여전히 트리거 단일, 사유 enrichment 예외만 추가.
COMMENT ON TABLE schedule_changes IS
  '일정 변경 audit — append-only 로그(#572 ADR-0054). writer=DB 트리거 단일 계기(record_schedule_date_change / record_schedule_deletion). schedule_id FK 없음(users FK는 유지) — 일정 삭제 후에도 schedule_id·이력 유지. 웹·Slack 버튼·에이전트 SQL·수동 psql 전 경로가 단일 계기로 수렴. 예외(#590 ADR-0060): 삭제 tombstone의 delete_reason_* 2컬럼만 삭제 직후 앱(웹 API·에이전트 SQL)이 fill-NULL-only UPDATE로 1회 enrichment — 트리거 기록 필드는 불변.';

-- ═══ ② 시드 신호 신설 — 변심 삭제 발생일 (100 §④ 패턴) ═══
-- source='seed'라 signal-sql-guard(LLM 전용)·승인 게이트 비대상(086·100·101 전례).
-- active 즉시 다음 월요일 P5a 발굴이 (시드×신호) 후보 여집합에 자동 편입.
-- 존재-윈도우: audit 도메인 dataStart는 schedule_changes 최초 행 기준 — 사유 도입 전 구간(약 1주)은
--   0으로 관측되는 좌단 아티팩트가 있으나 삭제는 희소 이벤트라 실질 영향 없음(ADR-0060 명시).
INSERT INTO signal_defs (user_id, name, kind, sql_body, value_type, direction, threshold, domain, description, source, status)
VALUES (1, 'audit_cancel_changed_mind', 'sql',
  $sql$SELECT COUNT(*) FROM schedule_changes
WHERE user_id=$1 AND change_type='deleted'
  AND delete_reason_category='changed_mind'
  AND DATE(changed_at AT TIME ZONE 'Asia/Seoul')=$2$sql$,
  'continuous', 'above_abs', 1, 'audit',
  '하기 싫어져서(변심) 일정을 삭제한 날 (삭제 사유 기록 기반)', 'seed', 'active')
ON CONFLICT DO NOTHING;

-- ═══ ③ schedule_fate view 재생성 — 사유 컬럼 노출 (#574 선행) ═══
-- 100 §⑥ 정의 유지 + 말미에 delete_reason_category만 추가(CREATE OR REPLACE는 기존 컬럼
-- 명·순서·타입 불변 + 신규 컬럼 끝 추가만 허용). 살아있는 일정 arm은 NULL.
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
         changed_at AS deleted_at,
         delete_reason_category
  FROM schedule_changes WHERE change_type='deleted'
)
SELECT s.user_id, s.id AS schedule_id,
       DATE(s.created_at AT TIME ZONE 'Asia/Seoul') AS cohort_date,
       s.category_id, s.status AS final_status, false AS is_deleted,
       NULL::timestamptz AS deleted_at,
       COALESCE(p.net_postpone_days, 0) AS net_postpone_days,
       NULL::text AS delete_reason_category
FROM schedules s LEFT JOIN postpones p ON p.schedule_id = s.id
UNION ALL
SELECT t.user_id, t.schedule_id,
       DATE(t.schedule_created_at AT TIME ZONE 'Asia/Seoul') AS cohort_date,
       t.category_id, t.status_at_deletion AS final_status, true AS is_deleted,
       t.deleted_at,
       COALESCE(p.net_postpone_days, 0) AS net_postpone_days,
       t.delete_reason_category
FROM tombstones t LEFT JOIN postpones p ON p.schedule_id = t.schedule_id;

COMMENT ON VIEW schedule_fate IS
  '일정 단위 궤적 — 생성일(KST cohort_date) 코호트 추적 기반 (#572 ADR-0054, #574 선행). 살아있는 일정(schedules) + 삭제 일정(tombstone) 합집합으로 생존 편향 방지. net_postpone_days는 (일정×하루) 순변위 미룸 일수. delete_reason_category(#590 ADR-0060)로 삭제 사유 슬라이스 가능(살아있는 일정은 NULL). 코호트 신호 정의·성숙 기간·e-value 정합은 #574에서 설계.';

-- ═══ ④ 자기검증 DO 블록 ═══════════════════════════════════
-- 임시 일정 INSERT → DELETE(tombstone 트리거) → enrichment UPDATE(fill-NULL-only 규약 그대로) →
-- 사유 저장 확인 → 무효 카테고리 UPDATE가 check_violation으로 거부되는지 확인 →
-- schedule_fate에서 사유 노출 확인 → 테스트 audit 행 전부 DELETE 정리(남기면 그날 삭제 신호 오염).
DO $$
DECLARE
  tmp_id INT; tomb_id INT; got_cat TEXT; got_text TEXT; fate_cat TEXT; guard_ok BOOLEAN := false;
BEGIN
  INSERT INTO schedules (user_id, title, date) VALUES (1, '__migration_106_selftest__', '2000-01-01')
    RETURNING id INTO tmp_id;
  DELETE FROM schedules WHERE id = tmp_id;
  SELECT id INTO tomb_id FROM schedule_changes WHERE schedule_id = tmp_id AND change_type = 'deleted';
  IF tomb_id IS NULL THEN RAISE EXCEPTION '[106④] 삭제 tombstone 미기록'; END IF;

  UPDATE schedule_changes SET delete_reason_category = 'changed_mind', delete_reason_text = 'selftest'
   WHERE id = tomb_id AND delete_reason_category IS NULL;
  SELECT delete_reason_category, delete_reason_text INTO got_cat, got_text
    FROM schedule_changes WHERE id = tomb_id;
  IF got_cat IS DISTINCT FROM 'changed_mind' OR got_text IS DISTINCT FROM 'selftest' THEN
    RAISE EXCEPTION '[106④] 사유 enrichment 실패 — category %, text %', got_cat, got_text;
  END IF;

  BEGIN
    UPDATE schedule_changes SET delete_reason_category = 'bogus' WHERE id = tomb_id;
    RAISE EXCEPTION '[106④] 무효 카테고리가 CHECK를 통과함';
  EXCEPTION WHEN check_violation THEN
    guard_ok := true;
  END;
  IF NOT guard_ok THEN RAISE EXCEPTION '[106④] CHECK 거부 검증 로직 오류'; END IF;

  SELECT delete_reason_category INTO fate_cat
    FROM schedule_fate WHERE schedule_id = tmp_id AND is_deleted;
  IF fate_cat IS DISTINCT FROM 'changed_mind' THEN
    RAISE EXCEPTION '[106④] schedule_fate 사유 컬럼 미노출 — %', fate_cat;
  END IF;

  DELETE FROM schedule_changes WHERE schedule_id = tmp_id;
  RAISE NOTICE '[106④] 사유 컬럼·CHECK·fate 노출 자기검증 OK';
END $$;

-- ═══ ⑤ 정합 검증 DO 블록 (100 §⑦ 스타일) ═══════════════════
DO $$
DECLARE
  col_cnt INT;
  ck_cnt INT;
  sig_cnt INT;
  fate_col INT;
BEGIN
  SELECT count(*) INTO col_cnt FROM information_schema.columns
   WHERE table_name = 'schedule_changes'
     AND column_name IN ('delete_reason_category', 'delete_reason_text');
  IF col_cnt <> 2 THEN
    RAISE EXCEPTION '[106⑤] 사유 컬럼 수 이상 — % (기대 2)', col_cnt;
  END IF;

  SELECT count(*) INTO ck_cnt FROM pg_constraint
   WHERE conrelid = 'schedule_changes'::regclass AND contype = 'c'
     AND conname IN ('schedule_changes_delete_reason_category_check',
                     'schedule_changes_delete_reason_text_check');
  IF ck_cnt <> 2 THEN
    RAISE EXCEPTION '[106⑤] CHECK 제약 수 이상 — % (기대 2)', ck_cnt;
  END IF;

  SELECT count(*) INTO sig_cnt FROM signal_defs
   WHERE user_id = 1 AND name = 'audit_cancel_changed_mind' AND status = 'active';
  IF sig_cnt <> 1 THEN
    RAISE EXCEPTION '[106⑤] 시드 신호 active 수 이상 — % (기대 1)', sig_cnt;
  END IF;

  SELECT count(*) INTO fate_col FROM information_schema.columns
   WHERE table_name = 'schedule_fate' AND column_name = 'delete_reason_category';
  IF fate_col <> 1 THEN
    RAISE EXCEPTION '[106⑤] schedule_fate 사유 컬럼 미노출';
  END IF;

  RAISE NOTICE '[106⑤] 정합 검증 완료 — 컬럼 2 / CHECK 2 / 신호 active 1 / view 컬럼 1';
END $$;
