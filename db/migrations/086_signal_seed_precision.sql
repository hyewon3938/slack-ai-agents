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

-- ═══ ② 누적 카운트 시드 은퇴 → 강도 밴드 위임 ═══════════════
-- 고정 임계 누적 시드(화 오행·편재 N1~N5, 10개)는 baseline 포화 시 off-day 0 → 죽는다(본인 화는
-- 운에 늘 깔려 N1~N3 매일 발현 = 측정 11/11). 동일 "오늘 화/재성이 평소보다 강한가"를 강도 밴드
-- (ADR-0036)가 상대 분위수·주간 재계산·가중치로 포화 없이 더 정교하게 측정 → 위임하고 누적은 archive.

-- archive 사유 컬럼 (③ 부활 스코프 + ② 위임 구분). NULL=활성 또는 수동 archive.
ALTER TABLE pattern_catalog ADD COLUMN IF NOT EXISTS archived_reason TEXT;
COMMENT ON COLUMN pattern_catalog.archived_reason IS
  'archive 사유 (#508 ADR-0046). saturation=③ 포화 자동 archive(부활 대상) · delegated_to_strength_band=② 누적 위임(부활 제외) · NULL=활성 또는 수동.';

-- 누적 시드 10개 archive. delegated_to_strength_band은 ③ 부활 제외 스코프(강도 밴드가 영구 대체).
-- LIKE의 '_'는 단일문자 와일드카드지만 접두가 충분히 구체적이라 정확히 10개(화 5 + 편재 5)만 매칭.
UPDATE pattern_catalog SET active = false, archived_reason = 'delegated_to_strength_band'
 WHERE user_id = 1 AND active = true
   AND (name LIKE 'pool_화_오행_누적_N%' OR name LIKE 'pool_편재_누적_N%');

-- 해당 시드 링크 archive (가역). confirmed 링크가 있으면 sticky라 노출 사라짐 — 의도된 위임.
UPDATE pattern_links SET status = 'archived', updated_at = NOW()
 WHERE user_id = 1 AND status IN ('active', 'pending', 'weak', 'confirmed')
   AND seed_id IN (SELECT id FROM pattern_catalog
                    WHERE user_id = 1 AND archived_reason = 'delegated_to_strength_band');

-- ② 검증
DO $$
DECLARE
  cum_active INT;
  delegated INT;
BEGIN
  SELECT count(*) INTO cum_active FROM pattern_catalog
   WHERE user_id = 1 AND active = true
     AND (name LIKE 'pool_화_오행_누적_N%' OR name LIKE 'pool_편재_누적_N%');
  IF cum_active <> 0 THEN
    RAISE EXCEPTION '[086②] 누적 시드 archive 실패 — active %', cum_active;
  END IF;
  SELECT count(*) INTO delegated FROM pattern_catalog
   WHERE user_id = 1 AND archived_reason = 'delegated_to_strength_band';
  IF delegated <> 10 THEN
    RAISE EXCEPTION '[086②] 위임 archive 시드 수 이상 — % (기대 10)', delegated;
  END IF;
  RAISE NOTICE '[086②] 누적 시드 % 개 강도 밴드 위임 완료 (부활 제외)', delegated;
END $$;
