-- 052: 사주 시드 16개 + 메트릭 등록 (user_id=1, 일간 경금 / 일지 술토)
-- 자동 생성: scripts/generate-saju-seeds.ts
-- 트리거 분기:
--   'stem'/'branch'/'sibiunsung': trigger_target_id로 마스터 참조
--   'relation'/'element_density': trigger_aux JSONB로 복합 조건 표현

-- ── S1_갑목_편재_천간 ──
DO $$
DECLARE
  s_id INTEGER;
  t_id INTEGER;
BEGIN
  SELECT id INTO t_id FROM stems_master WHERE name='갑';
  INSERT INTO saju_signal_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, source)
    VALUES (1, 'S1_갑목_편재_천간', '편재', $sql$일운 천간 갑목(편재) → 일정/지출 폭증 가능성$sql$, 'stem', t_id, NULL, 'seed')
    ON CONFLICT (user_id, name) DO UPDATE SET description=EXCLUDED.description, trigger_target_id=EXCLUDED.trigger_target_id, trigger_aux=EXCLUDED.trigger_aux
    RETURNING id INTO s_id;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'schedule_created', $sql$SELECT COUNT(*) FROM schedules WHERE user_id=$1 AND DATE(created_at AT TIME ZONE 'Asia/Seoul')=$2$sql$, 'above_avg', NULL, 'schedule')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'expense_total', $sql$SELECT COALESCE(SUM(amount),0) FROM expenses WHERE user_id=$1 AND date=$2 AND type='expense'$sql$, 'above_avg', NULL, 'expense')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'schedule_done', $sql$SELECT COUNT(*) FROM schedules WHERE user_id=$1 AND date=$2 AND status='done'$sql$, 'above_avg', NULL, 'schedule')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
END $$;

-- ── S2_사화_편관_사술원진 ──
DO $$
DECLARE
  s_id INTEGER;
  t_id INTEGER;
BEGIN
  t_id := NULL;
  INSERT INTO saju_signal_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, source)
    VALUES (1, 'S2_사화_편관_사술원진', '편관', $sql$일운 지지 사 + 본명 술 원진 → 짜증/건강 트러블 + 책임 처리 다층 가설$sql$, 'relation', t_id, '{"day_branch":"사","natal_branches":["술"],"relation_types":["원진"]}'::jsonb, 'seed')
    ON CONFLICT (user_id, name) DO UPDATE SET description=EXCLUDED.description, trigger_target_id=EXCLUDED.trigger_target_id, trigger_aux=EXCLUDED.trigger_aux
    RETURNING id INTO s_id;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'diary_irritation', $sql$SELECT COUNT(*) FROM diary_meta_tags WHERE user_id=$1 AND date=$2 AND tag='irritation'$sql$, 'flag_present', 1, 'diary_meta')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'diary_health_complaint', $sql$SELECT COUNT(*) FROM diary_meta_tags WHERE user_id=$1 AND date=$2 AND tag='health_complaint'$sql$, 'flag_present', 1, 'diary_meta')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'schedule_completion_rate', $sql$SELECT COALESCE(SUM(CASE WHEN status='done' THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0), 0) FROM schedules WHERE user_id=$1 AND date=$2$sql$, 'above_avg', NULL, 'schedule')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'audit_postponed_done', $sql$WITH rc AS (SELECT sc.schedule_id, COUNT(*) AS n FROM schedule_changes sc JOIN schedules s ON s.id=sc.schedule_id WHERE sc.user_id=$1 AND sc.change_type='date_changed' AND sc.changed_at > s.created_at + INTERVAL '30 minutes' GROUP BY sc.schedule_id) SELECT COUNT(*) FROM schedules s JOIN rc ON rc.schedule_id=s.id WHERE s.user_id=$1 AND s.date=$2 AND s.status='done' AND rc.n >= 2$sql$, 'above_abs', 1, 'audit')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
END $$;

-- ── S3_계수_상관_천간 ──
DO $$
DECLARE
  s_id INTEGER;
  t_id INTEGER;
BEGIN
  SELECT id INTO t_id FROM stems_master WHERE name='계';
  INSERT INTO saju_signal_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, source)
    VALUES (1, 'S3_계수_상관_천간', '상관', $sql$일운 천간 계수(상관) → 배달/루틴↓/일정 미루기$sql$, 'stem', t_id, NULL, 'seed')
    ON CONFLICT (user_id, name) DO UPDATE SET description=EXCLUDED.description, trigger_target_id=EXCLUDED.trigger_target_id, trigger_aux=EXCLUDED.trigger_aux
    RETURNING id INTO s_id;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'expense_배달음식', $sql$SELECT COALESCE(SUM(amount),0) FROM expenses WHERE user_id=$1 AND date=$2 AND type='expense' AND category='배달음식'$sql$, 'above_avg', NULL, 'expense')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'routine_completion_rate', $sql$SELECT COALESCE(SUM(CASE WHEN completed THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0), 0) FROM routine_records WHERE user_id=$1 AND date=$2$sql$, 'below_avg', NULL, 'routine')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'audit_date_changed', $sql$SELECT COUNT(*) FROM schedule_changes WHERE user_id=$1 AND change_type='date_changed' AND DATE(changed_at AT TIME ZONE 'Asia/Seoul')=$2$sql$, 'above_avg', NULL, 'audit')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
END $$;

-- ── S4_기토_정인_천간 ──
DO $$
DECLARE
  s_id INTEGER;
  t_id INTEGER;
BEGIN
  SELECT id INTO t_id FROM stems_master WHERE name='기';
  INSERT INTO saju_signal_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, source)
    VALUES (1, 'S4_기토_정인_천간', '정인', $sql$일운 천간 기토(정인) → 낮잠/휴식/평온$sql$, 'stem', t_id, NULL, 'seed')
    ON CONFLICT (user_id, name) DO UPDATE SET description=EXCLUDED.description, trigger_target_id=EXCLUDED.trigger_target_id, trigger_aux=EXCLUDED.trigger_aux
    RETURNING id INTO s_id;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'sleep_nap_count', $sql$SELECT COUNT(*) FROM sleep_records WHERE user_id=$1 AND date=$2 AND sleep_type='nap'$sql$, 'above_abs', 1, 'sleep')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'sleep_total_minutes', $sql$SELECT COALESCE(SUM(duration_minutes),0) FROM sleep_records WHERE user_id=$1 AND date=$2$sql$, 'above_avg', NULL, 'sleep')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'diary_rest', $sql$SELECT COUNT(*) FROM diary_meta_tags WHERE user_id=$1 AND date=$2 AND tag='rest'$sql$, 'flag_present', 1, 'diary_meta')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'diary_peaceful', $sql$SELECT COUNT(*) FROM diary_meta_tags WHERE user_id=$1 AND date=$2 AND tag='peaceful'$sql$, 'flag_present', 1, 'diary_meta')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'diary_mood_high', $sql$SELECT COUNT(*) FROM diary_meta_tags WHERE user_id=$1 AND date=$2 AND tag='mood_high'$sql$, 'flag_present', 1, 'diary_meta')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
END $$;

-- ── S5_토_과다 ──
DO $$
DECLARE
  s_id INTEGER;
  t_id INTEGER;
BEGIN
  t_id := NULL;
  INSERT INTO saju_signal_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, source)
    VALUES (1, 'S5_토_과다', NULL, $sql$본명 토 2개 + 일운 토 합산 ≥ 4 → 무기력/수면↑$sql$, 'element_density', t_id, '{"element":"토","min_count":4}'::jsonb, 'seed')
    ON CONFLICT (user_id, name) DO UPDATE SET description=EXCLUDED.description, trigger_target_id=EXCLUDED.trigger_target_id, trigger_aux=EXCLUDED.trigger_aux
    RETURNING id INTO s_id;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'diary_low_energy', $sql$SELECT COUNT(*) FROM diary_meta_tags WHERE user_id=$1 AND date=$2 AND tag='low_energy'$sql$, 'flag_present', 1, 'diary_meta')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'routine_completion_rate', $sql$SELECT COALESCE(SUM(CASE WHEN completed THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0), 0) FROM routine_records WHERE user_id=$1 AND date=$2$sql$, 'below_avg', NULL, 'routine')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'sleep_wake_hour', $sql$SELECT COALESCE(EXTRACT(HOUR FROM MIN(wake_time::time)),0) FROM sleep_records WHERE user_id=$1 AND date=$2 AND sleep_type='night'$sql$, 'above_avg', NULL, 'sleep')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
END $$;

-- ── S6_사지묘지 ──
DO $$
DECLARE
  s_id INTEGER;
  t_id INTEGER;
BEGIN
  t_id := NULL;
  INSERT INTO saju_signal_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, source)
    VALUES (1, 'S6_사지묘지', NULL, $sql$일간 경 기준 12운성 사/묘 (지지 자/축) → 컨디션↓/병원$sql$, 'sibiunsung', t_id, '{"states":["사","묘"]}'::jsonb, 'seed')
    ON CONFLICT (user_id, name) DO UPDATE SET description=EXCLUDED.description, trigger_target_id=EXCLUDED.trigger_target_id, trigger_aux=EXCLUDED.trigger_aux
    RETURNING id INTO s_id;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'diary_low_energy', $sql$SELECT COUNT(*) FROM diary_meta_tags WHERE user_id=$1 AND date=$2 AND tag='low_energy'$sql$, 'flag_present', 1, 'diary_meta')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'diary_mood_down', $sql$SELECT COUNT(*) FROM diary_meta_tags WHERE user_id=$1 AND date=$2 AND tag='mood_down'$sql$, 'flag_present', 1, 'diary_meta')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'sleep_night_minutes', $sql$SELECT COALESCE(SUM(duration_minutes),0) FROM sleep_records WHERE user_id=$1 AND date=$2 AND sleep_type='night'$sql$, 'above_avg', NULL, 'sleep')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'routine_rate_운동', $sql$SELECT COALESCE(SUM(CASE WHEN rr.completed THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0), 0) FROM routine_records rr JOIN routine_templates rt ON rt.id=rr.template_id WHERE rr.user_id=$1 AND rr.date=$2 AND rt.category='운동'$sql$, 'below_avg', NULL, 'routine')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'expense_hospital_excl_installment', $sql$SELECT COALESCE(SUM(amount),0) FROM expenses WHERE user_id=$1 AND date=$2 AND type='expense' AND category='병원' AND (memo IS NULL OR memo NOT LIKE '%할부%')$sql$, 'above_abs', 1, 'expense')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
END $$;

-- ── S7_경금_비견_천간 ──
DO $$
DECLARE
  s_id INTEGER;
  t_id INTEGER;
BEGIN
  SELECT id INTO t_id FROM stems_master WHERE name='경';
  INSERT INTO saju_signal_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, source)
    VALUES (1, 'S7_경금_비견_천간', '비견', $sql$일운 천간 경금(비견) → 자신감/완료율↑$sql$, 'stem', t_id, NULL, 'seed')
    ON CONFLICT (user_id, name) DO UPDATE SET description=EXCLUDED.description, trigger_target_id=EXCLUDED.trigger_target_id, trigger_aux=EXCLUDED.trigger_aux
    RETURNING id INTO s_id;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'diary_confidence_high', $sql$SELECT COUNT(*) FROM diary_meta_tags WHERE user_id=$1 AND date=$2 AND tag='confidence_high'$sql$, 'flag_present', 1, 'diary_meta')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'schedule_completion_rate', $sql$SELECT COALESCE(SUM(CASE WHEN status='done' THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0), 0) FROM schedules WHERE user_id=$1 AND date=$2$sql$, 'above_avg', NULL, 'schedule')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
END $$;

-- ── S8_무토_편인_천간 ──
DO $$
DECLARE
  s_id INTEGER;
  t_id INTEGER;
BEGIN
  SELECT id INTO t_id FROM stems_master WHERE name='무';
  INSERT INTO saju_signal_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, source)
    VALUES (1, 'S8_무토_편인_천간', '편인', $sql$일운 천간 무토(편인) → 분석/영화/깊은 사유$sql$, 'stem', t_id, NULL, 'seed')
    ON CONFLICT (user_id, name) DO UPDATE SET description=EXCLUDED.description, trigger_target_id=EXCLUDED.trigger_target_id, trigger_aux=EXCLUDED.trigger_aux
    RETURNING id INTO s_id;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'diary_analytical_mode', $sql$SELECT COUNT(*) FROM diary_meta_tags WHERE user_id=$1 AND date=$2 AND tag='analytical_mode'$sql$, 'flag_present', 1, 'diary_meta')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'diary_deep_thought', $sql$SELECT COUNT(*) FROM diary_meta_tags WHERE user_id=$1 AND date=$2 AND tag='deep_thought'$sql$, 'flag_present', 1, 'diary_meta')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'schedule_영화', $sql$SELECT COUNT(*) FROM schedules WHERE user_id=$1 AND date=$2 AND category='영화'$sql$, 'above_abs', 1, 'schedule')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
END $$;

-- ── N1_임수_식신_천간 ──
DO $$
DECLARE
  s_id INTEGER;
  t_id INTEGER;
BEGIN
  SELECT id INTO t_id FROM stems_master WHERE name='임';
  INSERT INTO saju_signal_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, source)
    VALUES (1, 'N1_임수_식신_천간', '식신', $sql$일운 천간 임수(식신) → 요리/창작/대화/먹기$sql$, 'stem', t_id, NULL, 'seed')
    ON CONFLICT (user_id, name) DO UPDATE SET description=EXCLUDED.description, trigger_target_id=EXCLUDED.trigger_target_id, trigger_aux=EXCLUDED.trigger_aux
    RETURNING id INTO s_id;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'expense_식재료', $sql$SELECT COALESCE(SUM(amount),0) FROM expenses WHERE user_id=$1 AND date=$2 AND type='expense' AND category='식재료'$sql$, 'above_avg', NULL, 'expense')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'expense_외식', $sql$SELECT COALESCE(SUM(amount),0) FROM expenses WHERE user_id=$1 AND date=$2 AND type='expense' AND category='외식'$sql$, 'above_avg', NULL, 'expense')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'expense_배달음식', $sql$SELECT COALESCE(SUM(amount),0) FROM expenses WHERE user_id=$1 AND date=$2 AND type='expense' AND category='배달음식'$sql$, 'above_avg', NULL, 'expense')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'diary_cooking', $sql$SELECT COUNT(*) FROM diary_meta_tags WHERE user_id=$1 AND date=$2 AND tag='cooking'$sql$, 'flag_present', 1, 'diary_meta')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'diary_creating', $sql$SELECT COUNT(*) FROM diary_meta_tags WHERE user_id=$1 AND date=$2 AND tag='creating'$sql$, 'flag_present', 1, 'diary_meta')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'diary_talkative', $sql$SELECT COUNT(*) FROM diary_meta_tags WHERE user_id=$1 AND date=$2 AND tag='talkative'$sql$, 'flag_present', 1, 'diary_meta')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
END $$;

-- ── N2_해수_식신_지지 ──
DO $$
DECLARE
  s_id INTEGER;
  t_id INTEGER;
BEGIN
  SELECT id INTO t_id FROM branches_master WHERE name='해';
  INSERT INTO saju_signal_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, source)
    VALUES (1, 'N2_해수_식신_지지', '식신', $sql$일운 지지 해수(식신) → N1과 천간/지지 발현 비교$sql$, 'branch', t_id, NULL, 'seed')
    ON CONFLICT (user_id, name) DO UPDATE SET description=EXCLUDED.description, trigger_target_id=EXCLUDED.trigger_target_id, trigger_aux=EXCLUDED.trigger_aux
    RETURNING id INTO s_id;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'expense_식재료', $sql$SELECT COALESCE(SUM(amount),0) FROM expenses WHERE user_id=$1 AND date=$2 AND type='expense' AND category='식재료'$sql$, 'above_avg', NULL, 'expense')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'expense_외식', $sql$SELECT COALESCE(SUM(amount),0) FROM expenses WHERE user_id=$1 AND date=$2 AND type='expense' AND category='외식'$sql$, 'above_avg', NULL, 'expense')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'expense_배달음식', $sql$SELECT COALESCE(SUM(amount),0) FROM expenses WHERE user_id=$1 AND date=$2 AND type='expense' AND category='배달음식'$sql$, 'above_avg', NULL, 'expense')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'diary_cooking', $sql$SELECT COUNT(*) FROM diary_meta_tags WHERE user_id=$1 AND date=$2 AND tag='cooking'$sql$, 'flag_present', 1, 'diary_meta')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'diary_creating', $sql$SELECT COUNT(*) FROM diary_meta_tags WHERE user_id=$1 AND date=$2 AND tag='creating'$sql$, 'flag_present', 1, 'diary_meta')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'diary_talkative', $sql$SELECT COUNT(*) FROM diary_meta_tags WHERE user_id=$1 AND date=$2 AND tag='talkative'$sql$, 'flag_present', 1, 'diary_meta')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
END $$;

-- ── N3_진토_편인_진술충 ──
DO $$
DECLARE
  s_id INTEGER;
  t_id INTEGER;
BEGIN
  t_id := NULL;
  INSERT INTO saju_signal_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, source)
    VALUES (1, 'N3_진토_편인_진술충', '편인', $sql$일운 지지 진 + 본명 술 충 → 향수/불안/과거 기억$sql$, 'relation', t_id, '{"day_branch":"진","natal_branches":["술"],"relation_types":["충"]}'::jsonb, 'seed')
    ON CONFLICT (user_id, name) DO UPDATE SET description=EXCLUDED.description, trigger_target_id=EXCLUDED.trigger_target_id, trigger_aux=EXCLUDED.trigger_aux
    RETURNING id INTO s_id;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'diary_nostalgia', $sql$SELECT COUNT(*) FROM diary_meta_tags WHERE user_id=$1 AND date=$2 AND tag='nostalgia'$sql$, 'flag_present', 1, 'diary_meta')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'diary_anxiety', $sql$SELECT COUNT(*) FROM diary_meta_tags WHERE user_id=$1 AND date=$2 AND tag='anxiety'$sql$, 'flag_present', 1, 'diary_meta')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'diary_past_memory', $sql$SELECT COUNT(*) FROM diary_meta_tags WHERE user_id=$1 AND date=$2 AND tag='past_memory'$sql$, 'flag_present', 1, 'diary_meta')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
END $$;

-- ── N4_축미_정인_지지 ──
DO $$
DECLARE
  s_id INTEGER;
  t_id INTEGER;
BEGIN
  SELECT id INTO t_id FROM branches_master WHERE name='축';
  INSERT INTO saju_signal_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, source)
    VALUES (1, 'N4_축미_정인_지지', '정인', $sql$일운 지지 축 또는 미(정인) → S4와 천간/지지 발현 비교$sql$, 'branch', t_id, '{"or_branches":["미"]}'::jsonb, 'seed')
    ON CONFLICT (user_id, name) DO UPDATE SET description=EXCLUDED.description, trigger_target_id=EXCLUDED.trigger_target_id, trigger_aux=EXCLUDED.trigger_aux
    RETURNING id INTO s_id;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'sleep_nap_count', $sql$SELECT COUNT(*) FROM sleep_records WHERE user_id=$1 AND date=$2 AND sleep_type='nap'$sql$, 'above_abs', 1, 'sleep')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'sleep_total_minutes', $sql$SELECT COALESCE(SUM(duration_minutes),0) FROM sleep_records WHERE user_id=$1 AND date=$2$sql$, 'above_avg', NULL, 'sleep')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'diary_rest', $sql$SELECT COUNT(*) FROM diary_meta_tags WHERE user_id=$1 AND date=$2 AND tag='rest'$sql$, 'flag_present', 1, 'diary_meta')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'diary_peaceful', $sql$SELECT COUNT(*) FROM diary_meta_tags WHERE user_id=$1 AND date=$2 AND tag='peaceful'$sql$, 'flag_present', 1, 'diary_meta')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'diary_mood_high', $sql$SELECT COUNT(*) FROM diary_meta_tags WHERE user_id=$1 AND date=$2 AND tag='mood_high'$sql$, 'flag_present', 1, 'diary_meta')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
END $$;

-- ── N5_술_편인_지지 ──
DO $$
DECLARE
  s_id INTEGER;
  t_id INTEGER;
BEGIN
  SELECT id INTO t_id FROM branches_master WHERE name='술';
  INSERT INTO saju_signal_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, source)
    VALUES (1, 'N5_술_편인_지지', '편인', $sql$일운 지지 술(편인, 본명 일지 술 비화) → S8과 비교$sql$, 'branch', t_id, NULL, 'seed')
    ON CONFLICT (user_id, name) DO UPDATE SET description=EXCLUDED.description, trigger_target_id=EXCLUDED.trigger_target_id, trigger_aux=EXCLUDED.trigger_aux
    RETURNING id INTO s_id;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'diary_analytical_mode', $sql$SELECT COUNT(*) FROM diary_meta_tags WHERE user_id=$1 AND date=$2 AND tag='analytical_mode'$sql$, 'flag_present', 1, 'diary_meta')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'diary_deep_thought', $sql$SELECT COUNT(*) FROM diary_meta_tags WHERE user_id=$1 AND date=$2 AND tag='deep_thought'$sql$, 'flag_present', 1, 'diary_meta')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'schedule_영화', $sql$SELECT COUNT(*) FROM schedules WHERE user_id=$1 AND date=$2 AND category='영화'$sql$, 'above_abs', 1, 'schedule')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
END $$;

-- ── N6_정화_정관_천간 ──
DO $$
DECLARE
  s_id INTEGER;
  t_id INTEGER;
BEGIN
  SELECT id INTO t_id FROM stems_master WHERE name='정';
  INSERT INTO saju_signal_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, source)
    VALUES (1, 'N6_정화_정관_천간', '정관', $sql$일운 천간 정화(정관) → 책임/이직/세금 처리$sql$, 'stem', t_id, NULL, 'seed')
    ON CONFLICT (user_id, name) DO UPDATE SET description=EXCLUDED.description, trigger_target_id=EXCLUDED.trigger_target_id, trigger_aux=EXCLUDED.trigger_aux
    RETURNING id INTO s_id;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'schedule_completion_rate', $sql$SELECT COALESCE(SUM(CASE WHEN status='done' THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0), 0) FROM schedules WHERE user_id=$1 AND date=$2$sql$, 'above_avg', NULL, 'schedule')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'schedule_이직', $sql$SELECT COUNT(*) FROM schedules WHERE user_id=$1 AND date=$2 AND category='이직'$sql$, 'above_abs', 1, 'schedule')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'schedule_tax_keyword', $sql$SELECT COUNT(*) FROM schedules WHERE user_id=$1 AND date=$2 AND (title ILIKE '%세금%' OR title ILIKE '%공과금%' OR title ILIKE '%국세%' OR title ILIKE '%지방세%' OR title ILIKE '%연말정산%')$sql$, 'above_abs', 1, 'schedule')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'audit_postponed_done', $sql$WITH rc AS (SELECT sc.schedule_id, COUNT(*) AS n FROM schedule_changes sc JOIN schedules s ON s.id=sc.schedule_id WHERE sc.user_id=$1 AND sc.change_type='date_changed' AND sc.changed_at > s.created_at + INTERVAL '30 minutes' GROUP BY sc.schedule_id) SELECT COUNT(*) FROM schedules s JOIN rc ON rc.schedule_id=s.id WHERE s.user_id=$1 AND s.date=$2 AND s.status='done' AND rc.n >= 2$sql$, 'above_abs', 1, 'audit')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
END $$;

-- ── N7_오화_정관_지지 ──
DO $$
DECLARE
  s_id INTEGER;
  t_id INTEGER;
BEGIN
  SELECT id INTO t_id FROM branches_master WHERE name='오';
  INSERT INTO saju_signal_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, source)
    VALUES (1, 'N7_오화_정관_지지', '정관', $sql$일운 지지 오화(정관) → N6과 비교$sql$, 'branch', t_id, NULL, 'seed')
    ON CONFLICT (user_id, name) DO UPDATE SET description=EXCLUDED.description, trigger_target_id=EXCLUDED.trigger_target_id, trigger_aux=EXCLUDED.trigger_aux
    RETURNING id INTO s_id;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'schedule_completion_rate', $sql$SELECT COALESCE(SUM(CASE WHEN status='done' THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0), 0) FROM schedules WHERE user_id=$1 AND date=$2$sql$, 'above_avg', NULL, 'schedule')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'schedule_이직', $sql$SELECT COUNT(*) FROM schedules WHERE user_id=$1 AND date=$2 AND category='이직'$sql$, 'above_abs', 1, 'schedule')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'schedule_tax_keyword', $sql$SELECT COUNT(*) FROM schedules WHERE user_id=$1 AND date=$2 AND (title ILIKE '%세금%' OR title ILIKE '%공과금%' OR title ILIKE '%국세%' OR title ILIKE '%지방세%' OR title ILIKE '%연말정산%')$sql$, 'above_abs', 1, 'schedule')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'audit_postponed_done', $sql$WITH rc AS (SELECT sc.schedule_id, COUNT(*) AS n FROM schedule_changes sc JOIN schedules s ON s.id=sc.schedule_id WHERE sc.user_id=$1 AND sc.change_type='date_changed' AND sc.changed_at > s.created_at + INTERVAL '30 minutes' GROUP BY sc.schedule_id) SELECT COUNT(*) FROM schedules s JOIN rc ON rc.schedule_id=s.id WHERE s.user_id=$1 AND s.date=$2 AND s.status='done' AND rc.n >= 2$sql$, 'above_abs', 1, 'audit')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
END $$;

-- ── N8_병화_편관_천간 ──
DO $$
DECLARE
  s_id INTEGER;
  t_id INTEGER;
BEGIN
  SELECT id INTO t_id FROM stems_master WHERE name='병';
  INSERT INTO saju_signal_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, source)
    VALUES (1, 'N8_병화_편관_천간', '편관', $sql$일운 천간 병화(편관) → 양화 편관 발현 비교$sql$, 'stem', t_id, NULL, 'seed')
    ON CONFLICT (user_id, name) DO UPDATE SET description=EXCLUDED.description, trigger_target_id=EXCLUDED.trigger_target_id, trigger_aux=EXCLUDED.trigger_aux
    RETURNING id INTO s_id;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'schedule_completion_rate', $sql$SELECT COALESCE(SUM(CASE WHEN status='done' THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0), 0) FROM schedules WHERE user_id=$1 AND date=$2$sql$, 'above_avg', NULL, 'schedule')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'schedule_이직', $sql$SELECT COUNT(*) FROM schedules WHERE user_id=$1 AND date=$2 AND category='이직'$sql$, 'above_abs', 1, 'schedule')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'schedule_tax_keyword', $sql$SELECT COUNT(*) FROM schedules WHERE user_id=$1 AND date=$2 AND (title ILIKE '%세금%' OR title ILIKE '%공과금%' OR title ILIKE '%국세%' OR title ILIKE '%지방세%' OR title ILIKE '%연말정산%')$sql$, 'above_abs', 1, 'schedule')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
  INSERT INTO saju_signal_metrics (signal_id, metric_name, expected_metric_sql, expected_direction, expected_threshold, domain)
    VALUES (s_id, 'audit_postponed_done', $sql$WITH rc AS (SELECT sc.schedule_id, COUNT(*) AS n FROM schedule_changes sc JOIN schedules s ON s.id=sc.schedule_id WHERE sc.user_id=$1 AND sc.change_type='date_changed' AND sc.changed_at > s.created_at + INTERVAL '30 minutes' GROUP BY sc.schedule_id) SELECT COUNT(*) FROM schedules s JOIN rc ON rc.schedule_id=s.id WHERE s.user_id=$1 AND s.date=$2 AND s.status='done' AND rc.n >= 2$sql$, 'above_abs', 1, 'audit')
    ON CONFLICT (signal_id, metric_name) DO UPDATE SET expected_metric_sql=EXCLUDED.expected_metric_sql, expected_direction=EXCLUDED.expected_direction, expected_threshold=EXCLUDED.expected_threshold, domain=EXCLUDED.domain;
END $$;

