-- 055: S2 (사술원진) 시드 확장 — 분석/영화/책 가설 메트릭 추가
-- 사용자 임상: 사술 = 원진 + 귀문 동시 발현. 짜증·건강뿐 아니라 철학적 사고/영화/책 활동도 증가
-- description 보강 + diary_analytical_mode / diary_deep_thought / schedule_영화 메트릭 3개 append

DO $$
DECLARE
  s_id INTEGER;
BEGIN
  UPDATE saju_signal_catalog
  SET description = $sql$일운 지지 사 + 본명 술 원진+귀문 → 짜증/건강 + 책임처리 + 분석/영화/책 다층 가설$sql$
  WHERE user_id=1 AND name='S2_사화_편관_사술원진'
  RETURNING id INTO s_id;

  IF s_id IS NULL THEN
    RAISE NOTICE 'S2 seed not found, skipping metric expansion';
    RETURN;
  END IF;

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
