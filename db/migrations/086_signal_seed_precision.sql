-- 086: 신호·시드 측정 정밀화 (#508, ADR-0046)
-- 배경: #477(매트릭 중심 검증)·#504(발굴 측정 타당성) 운영 데이터에서 드러난 신호·시드 측정의
--   거칠음을 교정한다. 통계 스택·verdict·tier·임계치는 일절 불변 — *무엇을* 측정하는지(신호 정의)와
--   *어떤* 시드를 살려두는지(시드 위생)만 손댐.
-- 구성:
--   ① 일정 날짜 변경 방향 분리 — 방향무관 audit_date_changed 은퇴 → 미룸/당김 2신호.
--   ② 누적 카운트 시드 은퇴 → 강도 밴드 위임 — 고정 임계 누적 10개 archive(부활 제외).
--   (③ 포화 양방향 가드, ④ 동어반복 필터는 런타임 코드 — 스키마 변경 없음. archived_reason는 ②에서 추가.)
-- 안전: 파일 전체가 단일 암묵 트랜잭션(migrate.ts) — 말미 검증 DO 블록이 RAISE 시 전체 롤백.
--   모든 변경 가역(status·active 복원). 새 신호는 시드(source='seed')라 signal-sql-guard(LLM 전용) 비대상.

-- ═══ ① 일정 날짜 변경 방향 분리 ═══════════════════════════
-- audit_date_changed(방향무관 COUNT·above_avg)는 미룸(after>before)·당김(after<before)을 합산해
-- 반대 의미를 상쇄한다(off-day 대조 무의미화, 헌장 ② 위반). writer(웹)가 before_value/after_value에
-- 날짜를 다 기록하므로 방향 신호 2개(above_abs 1 — audit_postponed_done과 동일 이진화)로 분리하고
-- 방향무관은 status='rejected' 은퇴(측정·발굴 둘 다 status='active'만 필터). schedule_changes는
-- 기존 시드 신호(audit_postponed_done)가 이미 참조 — 신뢰 경로.

-- audit_date_postponed: 변경 후 날짜 > 변경 전 날짜 (미루는 뉘앙스)
INSERT INTO signal_defs (user_id, name, kind, sql_body, value_type, direction, threshold, domain, description, source, status)
VALUES (1, 'audit_date_postponed', 'sql',
  $sql$SELECT COUNT(*) FROM schedule_changes WHERE user_id=$1 AND change_type='date_changed' AND (after_value->>'date')::date > (before_value->>'date')::date AND DATE(changed_at AT TIME ZONE 'Asia/Seoul')=$2$sql$,
  'continuous', 'above_abs', 1, 'audit', '일정을 더 뒤로 미룬 날', 'seed', 'active')
ON CONFLICT DO NOTHING;

-- audit_date_advanced: 변경 후 날짜 < 변경 전 날짜 (미리 당겨 조율하는 뉘앙스)
INSERT INTO signal_defs (user_id, name, kind, sql_body, value_type, direction, threshold, domain, description, source, status)
VALUES (1, 'audit_date_advanced', 'sql',
  $sql$SELECT COUNT(*) FROM schedule_changes WHERE user_id=$1 AND change_type='date_changed' AND (after_value->>'date')::date < (before_value->>'date')::date AND DATE(changed_at AT TIME ZONE 'Asia/Seoul')=$2$sql$,
  'continuous', 'above_abs', 1, 'audit', '일정을 앞으로 당긴 날', 'seed', 'active')
ON CONFLICT DO NOTHING;

-- 방향무관 신호 은퇴 (rejected = 측정·발굴 제외 terminal). 링크도 archive(가역).
UPDATE signal_defs SET status = 'rejected'
 WHERE user_id = 1 AND name = 'audit_date_changed' AND status = 'active';
UPDATE pattern_links SET status = 'archived', updated_at = NOW()
 WHERE status = 'active'
   AND signal_id IN (SELECT id FROM signal_defs WHERE user_id = 1 AND name = 'audit_date_changed');

-- ① 검증
DO $$
DECLARE
  new_active INT;
  old_active INT;
BEGIN
  SELECT count(*) INTO new_active FROM signal_defs
   WHERE user_id = 1 AND name IN ('audit_date_postponed', 'audit_date_advanced') AND status = 'active';
  IF new_active <> 2 THEN
    RAISE EXCEPTION '[086①] 방향 신호 2개 신설 실패 — active %', new_active;
  END IF;
  SELECT count(*) INTO old_active FROM signal_defs
   WHERE user_id = 1 AND name = 'audit_date_changed' AND status = 'active';
  IF old_active <> 0 THEN
    RAISE EXCEPTION '[086①] audit_date_changed 은퇴 실패 — active %', old_active;
  END IF;
  RAISE NOTICE '[086①] 날짜 변경 방향 분리 완료 — 방향무관 은퇴, 미룸/당김 2신호 신설';
END $$;
