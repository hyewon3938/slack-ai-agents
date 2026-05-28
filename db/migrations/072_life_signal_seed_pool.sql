-- 072: 마스터 #434 Phase 3 — life_signal 시드 풀세트 INSERT (38개)
--
-- 카테고리:
--   환경 결정론 18개 — 요일 7 + 주말/평일 2 + 월위치 3 + 계절 4 + 공휴일 2
--   임계치 풀셋 9개 — 수면 4 + 루틴 streak 5
--   11종 결정론 패턴 승격 11개 — behavior_baseline kind (insights.ts detect 함수 위임)
--
-- 모두 trigger_target_type='life_signal' + pattern_kind='life_signal'
-- trigger_aux JSONB로 평가 명세 분기 (ADR-0029)
--
-- 매트릭 정책 (혼합):
--   강한 임상 가설 3개만 결정론 매트릭 (life_sleep_le_7, life_dow_월, life_holiday)
--   나머지 35개는 evidence-only (matched=NULL, verify_status='no_metric')
--
-- 폐기 결정 (구현 직후):
--   life_lunar_1 / life_lunar_15 — lunar kind 폐기. 사주는 절기 기준이지 음력 1/15 기준 아님,
--     명절/계절 효과는 calendar_event:holiday_next + season으로 커버, 임상 가설 0개 (ADR-0029 폐기 결정)
--
-- Follow-up (재진입 가능):
--   life_autopay — day_of_month 사용자 설정 UI 미구현. 본인 자동이체일 임시 박기는 가능

BEGIN;

-- ── 1) 환경 결정론 시드 18개 ──────────────────────────────

-- 요일 7개 (월~일)
INSERT INTO pattern_catalog
  (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active, pillar_level)
VALUES
  (1, 'life_dow_월', NULL, '월요일 발현일 — 일정 폭주·주 시작 부담 가설', 'life_signal', NULL,
   '{"kind":"weekday","dow":1}'::jsonb, 'life_signal', 'seed', true, NULL),
  (1, 'life_dow_화', NULL, '화요일 발현일', 'life_signal', NULL,
   '{"kind":"weekday","dow":2}'::jsonb, 'life_signal', 'seed', true, NULL),
  (1, 'life_dow_수', NULL, '수요일 발현일', 'life_signal', NULL,
   '{"kind":"weekday","dow":3}'::jsonb, 'life_signal', 'seed', true, NULL),
  (1, 'life_dow_목', NULL, '목요일 발현일', 'life_signal', NULL,
   '{"kind":"weekday","dow":4}'::jsonb, 'life_signal', 'seed', true, NULL),
  (1, 'life_dow_금', NULL, '금요일 발현일 — 불금 효과 가설', 'life_signal', NULL,
   '{"kind":"weekday","dow":5}'::jsonb, 'life_signal', 'seed', true, NULL),
  (1, 'life_dow_토', NULL, '토요일 발현일', 'life_signal', NULL,
   '{"kind":"weekday","dow":6}'::jsonb, 'life_signal', 'seed', true, NULL),
  (1, 'life_dow_일', NULL, '일요일 발현일 — 선데이 블루 가설', 'life_signal', NULL,
   '{"kind":"weekday","dow":0}'::jsonb, 'life_signal', 'seed', true, NULL)
ON CONFLICT (user_id, name) DO NOTHING;

-- weekday_group 2개
INSERT INTO pattern_catalog
  (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active, pillar_level)
VALUES
  (1, 'life_weekend', NULL, '주말(토·일) 발현일 — 일정 분포 변화, 휴식·외출 패턴', 'life_signal', NULL,
   '{"kind":"weekday_group","group":"weekend"}'::jsonb, 'life_signal', 'seed', true, NULL),
  (1, 'life_weekday', NULL, '평일(월~금) 발현일', 'life_signal', NULL,
   '{"kind":"weekday_group","group":"weekday"}'::jsonb, 'life_signal', 'seed', true, NULL)
ON CONFLICT (user_id, name) DO NOTHING;

-- month_position 3개
INSERT INTO pattern_catalog
  (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active, pillar_level)
VALUES
  (1, 'life_month_start', NULL, '월초 3일 — 한 달 시작 부담·계획 정리 가설', 'life_signal', NULL,
   '{"kind":"month_position","position":"start","range_days":3}'::jsonb, 'life_signal', 'seed', true, NULL),
  (1, 'life_month_end',   NULL, '월말 3일 — 카드 결제일·마무리 분위기 가설', 'life_signal', NULL,
   '{"kind":"month_position","position":"end","range_days":3}'::jsonb, 'life_signal', 'seed', true, NULL),
  (1, 'life_month_mid',   NULL, '월중 11~20일 — 안정적 진행 구간 가설', 'life_signal', NULL,
   '{"kind":"month_position","position":"mid","start":11,"end":20}'::jsonb, 'life_signal', 'seed', true, NULL)
ON CONFLICT (user_id, name) DO NOTHING;

-- season 4개
INSERT INTO pattern_catalog
  (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active, pillar_level)
VALUES
  (1, 'life_season_봄',   NULL, '봄(3~5월) — 환절기·알레르기 가설', 'life_signal', NULL,
   '{"kind":"season","season":"spring"}'::jsonb, 'life_signal', 'seed', true, NULL),
  (1, 'life_season_여름', NULL, '여름(6~8월) — 더위·수면 질 가설', 'life_signal', NULL,
   '{"kind":"season","season":"summer"}'::jsonb, 'life_signal', 'seed', true, NULL),
  (1, 'life_season_가을', NULL, '가을(9~11월) — 환절기·우울 가설', 'life_signal', NULL,
   '{"kind":"season","season":"autumn"}'::jsonb, 'life_signal', 'seed', true, NULL),
  (1, 'life_season_겨울', NULL, '겨울(12~2월) — 운동량 저하 가설', 'life_signal', NULL,
   '{"kind":"season","season":"winter"}'::jsonb, 'life_signal', 'seed', true, NULL)
ON CONFLICT (user_id, name) DO NOTHING;

-- calendar_event 2개 (공휴일·공휴일 다음날)
INSERT INTO pattern_catalog
  (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active, pillar_level)
VALUES
  (1, 'life_holiday',      NULL, '한국 공휴일 발현일 — 일정 분포 변화', 'life_signal', NULL,
   '{"kind":"calendar_event","event":"holiday"}'::jsonb, 'life_signal', 'seed', true, NULL),
  (1, 'life_holiday_next', NULL, '공휴일 다음날 — 명절·연휴 후유증 가설', 'life_signal', NULL,
   '{"kind":"calendar_event","event":"holiday_next"}'::jsonb, 'life_signal', 'seed', true, NULL)
ON CONFLICT (user_id, name) DO NOTHING;

-- ── 2) 임계치 풀셋 시드 9개 ─────────────────────────────────

-- sleep_minutes 4개 (5h, 6h, 7h, 8h)
INSERT INTO pattern_catalog
  (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active, pillar_level)
VALUES
  (1, 'life_sleep_le_5', NULL, '수면 ≤ 5시간 발현일 — 컨디션 저하 가설', 'life_signal', NULL,
   '{"kind":"threshold","source":"sleep_minutes","op":"lte","value":300}'::jsonb, 'life_signal', 'seed', true, NULL),
  (1, 'life_sleep_le_6', NULL, '수면 ≤ 6시간 발현일 — 컨디션 저하 가설', 'life_signal', NULL,
   '{"kind":"threshold","source":"sleep_minutes","op":"lte","value":360}'::jsonb, 'life_signal', 'seed', true, NULL),
  (1, 'life_sleep_le_7', NULL, '수면 ≤ 7시간 발현일 — 강한 임상 가설(health_complaint 동시발현)', 'life_signal', NULL,
   '{"kind":"threshold","source":"sleep_minutes","op":"lte","value":420}'::jsonb, 'life_signal', 'seed', true, NULL),
  (1, 'life_sleep_le_8', NULL, '수면 ≤ 8시간 발현일', 'life_signal', NULL,
   '{"kind":"threshold","source":"sleep_minutes","op":"lte","value":480}'::jsonb, 'life_signal', 'seed', true, NULL)
ON CONFLICT (user_id, name) DO NOTHING;

-- routine_streak_max 5개 (3, 5, 7, 14, 30일)
INSERT INTO pattern_catalog
  (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active, pillar_level)
VALUES
  (1, 'life_streak_ge_3',  NULL, '루틴 3일+ 연속 달성일 (active 루틴 중 최대 streak)', 'life_signal', NULL,
   '{"kind":"threshold","source":"routine_streak_max","op":"gte","value":3}'::jsonb, 'life_signal', 'seed', true, NULL),
  (1, 'life_streak_ge_5',  NULL, '루틴 5일+ 연속 달성일', 'life_signal', NULL,
   '{"kind":"threshold","source":"routine_streak_max","op":"gte","value":5}'::jsonb, 'life_signal', 'seed', true, NULL),
  (1, 'life_streak_ge_7',  NULL, '루틴 1주+ 연속 달성일 — milestone 가설', 'life_signal', NULL,
   '{"kind":"threshold","source":"routine_streak_max","op":"gte","value":7}'::jsonb, 'life_signal', 'seed', true, NULL),
  (1, 'life_streak_ge_14', NULL, '루틴 2주+ 연속 달성일', 'life_signal', NULL,
   '{"kind":"threshold","source":"routine_streak_max","op":"gte","value":14}'::jsonb, 'life_signal', 'seed', true, NULL),
  (1, 'life_streak_ge_30', NULL, '루틴 1개월+ 연속 달성일', 'life_signal', NULL,
   '{"kind":"threshold","source":"routine_streak_max","op":"gte","value":30}'::jsonb, 'life_signal', 'seed', true, NULL)
ON CONFLICT (user_id, name) DO NOTHING;

-- ── 3) 11종 결정론 패턴 시드 (behavior_baseline) ─────────────

INSERT INTO pattern_catalog
  (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active, pillar_level)
VALUES
  (1, 'life_behavior_streak',             NULL, '루틴 milestone streak 발현일 (INSIGHT_THRESHOLDS.streak.milestones)', 'life_signal', NULL,
   '{"kind":"behavior_baseline","signal_name":"streak"}'::jsonb, 'life_signal', 'seed', true, NULL),
  (1, 'life_behavior_sleep_trend',        NULL, '수면 추세 변화 발현일 (3일 평균 기준)', 'life_signal', NULL,
   '{"kind":"behavior_baseline","signal_name":"sleepTrend"}'::jsonb, 'life_signal', 'seed', true, NULL),
  (1, 'life_behavior_slot_gap',           NULL, '시간대 빈 슬롯 발생일', 'life_signal', NULL,
   '{"kind":"behavior_baseline","signal_name":"slotGap"}'::jsonb, 'life_signal', 'seed', true, NULL),
  (1, 'life_behavior_week_compare',       NULL, '주간 카테고리 분포 변화 발현일', 'life_signal', NULL,
   '{"kind":"behavior_baseline","signal_name":"weekComparison"}'::jsonb, 'life_signal', 'seed', true, NULL),
  (1, 'life_behavior_overdue',            NULL, '미완료 일정 누적 임계 초과일', 'life_signal', NULL,
   '{"kind":"behavior_baseline","signal_name":"overdueAlert"}'::jsonb, 'life_signal', 'seed', true, NULL),
  (1, 'life_behavior_skew',               NULL, '카테고리 쏠림 임계 초과일', 'life_signal', NULL,
   '{"kind":"behavior_baseline","signal_name":"categorySkew"}'::jsonb, 'life_signal', 'seed', true, NULL),
  (1, 'life_behavior_drift',              NULL, '카테고리 분포 점진 변화 감지일', 'life_signal', NULL,
   '{"kind":"behavior_baseline","signal_name":"drift"}'::jsonb, 'life_signal', 'seed', true, NULL),
  (1, 'life_behavior_recovery',           NULL, '루틴 lapse 후 복귀일', 'life_signal', NULL,
   '{"kind":"behavior_baseline","signal_name":"recovery"}'::jsonb, 'life_signal', 'seed', true, NULL),
  (1, 'life_behavior_lapse',              NULL, '정기 일정 N일째 누락일', 'life_signal', NULL,
   '{"kind":"behavior_baseline","signal_name":"lapseAlert"}'::jsonb, 'life_signal', 'seed', true, NULL),
  (1, 'life_behavior_weekly_regression',  NULL, '주간 성과 후퇴 발현일', 'life_signal', NULL,
   '{"kind":"behavior_baseline","signal_name":"weeklyRegression"}'::jsonb, 'life_signal', 'seed', true, NULL),
  (1, 'life_behavior_spotty',             NULL, '산발 패턴 발현일', 'life_signal', NULL,
   '{"kind":"behavior_baseline","signal_name":"spottyPattern"}'::jsonb, 'life_signal', 'seed', true, NULL)
ON CONFLICT (user_id, name) DO NOTHING;

-- ── 4) 결정론 매트릭 3개 (강한 임상 가설) ─────────────────

-- life_sleep_le_7 → 같은날 health_complaint enum 동시 발현 (flag_present)
DO $$
DECLARE
  p_id INTEGER;
BEGIN
  SELECT id INTO p_id FROM pattern_catalog WHERE user_id=1 AND name='life_sleep_le_7';
  IF p_id IS NOT NULL THEN
    INSERT INTO pattern_metrics
      (pattern_id, metric_name, expected_metric_sql, expected_direction, expected_threshold,
       domain, status, source)
    VALUES
      (p_id, 'same_day_health_complaint',
       $sql$SELECT COUNT(*) FROM diary_meta_tags WHERE user_id=$1 AND date=$2 AND tag='health_complaint'$sql$,
       'flag_present', 1, 'diary_meta', 'active', 'deterministic')
    ON CONFLICT (pattern_id, metric_name) DO NOTHING;
  END IF;
END $$;

-- life_dow_월 → 일정 수 above_avg (월요일 일정 폭주 가설)
DO $$
DECLARE
  p_id INTEGER;
BEGIN
  SELECT id INTO p_id FROM pattern_catalog WHERE user_id=1 AND name='life_dow_월';
  IF p_id IS NOT NULL THEN
    INSERT INTO pattern_metrics
      (pattern_id, metric_name, expected_metric_sql, expected_direction, expected_threshold,
       domain, status, source)
    VALUES
      (p_id, 'schedule_count_today',
       $sql$SELECT COUNT(*) FROM schedules WHERE user_id=$1 AND date=$2$sql$,
       'above_avg', NULL, 'schedule', 'active', 'deterministic')
    ON CONFLICT (pattern_id, metric_name) DO NOTHING;
  END IF;
END $$;

-- life_holiday → 일정 수 below_avg (공휴일에 일정 적음 가설)
DO $$
DECLARE
  p_id INTEGER;
BEGIN
  SELECT id INTO p_id FROM pattern_catalog WHERE user_id=1 AND name='life_holiday';
  IF p_id IS NOT NULL THEN
    INSERT INTO pattern_metrics
      (pattern_id, metric_name, expected_metric_sql, expected_direction, expected_threshold,
       domain, status, source)
    VALUES
      (p_id, 'schedule_count_today',
       $sql$SELECT COUNT(*) FROM schedules WHERE user_id=$1 AND date=$2$sql$,
       'below_avg', NULL, 'schedule', 'active', 'deterministic')
    ON CONFLICT (pattern_id, metric_name) DO NOTHING;
  END IF;
END $$;

COMMIT;
