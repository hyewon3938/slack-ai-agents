-- 068: saju_influence_summary view body 재정의 (마스터 A 운영 자산 보존)
-- ADR-0020 + ADR-0026
--
-- 본 마이그레이션은 063 rename으로 깨진 saju_influence_summary view를 복구한다.
-- view 이름·컬럼 contract는 *그대로 유지* (weekly-saju-review-v2 Routine과의 contract).
-- 내부에서 참조하는 테이블만 pattern_* 어휘로 교체.
--
-- 컬럼 contract (Routine이 SELECT):
--   user_id, signal_id, signal_name, sipsin, description, trigger_target_type,
--   enum_target, confidence_tier, metric_value, fdr_q, evaluated_at
--
-- 마스터 A는 별개 마스터(#421)이므로 view 이름·컬럼명 변경은 본 작업 범위 외 —
-- pattern_catalog.id를 signal_id로, pattern_catalog.name을 signal_name으로 *별칭 보존*.
-- accumulating tier는 deprecated catalog 카운트 대신 pattern_summary(시드 단위 derive)를
-- 참조하여 매트릭 단위 source of truth 원칙(ADR-0023) 준수.

CREATE OR REPLACE VIEW saju_influence_summary AS
WITH latest_stats AS (
  -- 가설별 가장 최근 주간 통계만 추출
  SELECT DISTINCT ON (hypothesis_id)
    hypothesis_id,
    week_start,
    rate_ratio,
    fdr_q
  FROM pattern_stats
  ORDER BY hypothesis_id, week_start DESC
),

verified AS (
  -- BH-FDR 통과한 active hypothesis (seed 타입만)
  SELECT
    h.user_id,
    c.id                  AS signal_id,
    c.name                AS signal_name,
    c.sipsin,
    c.description,
    c.trigger_target_type,
    h.enum_target,
    'verified'::text      AS confidence_tier,
    s.rate_ratio          AS metric_value,
    s.fdr_q,
    s.week_start          AS evaluated_at
  FROM pattern_hypotheses h
  JOIN latest_stats s
    ON s.hypothesis_id = h.id
  JOIN pattern_catalog c
    ON c.id = (h.trigger_spec->>'signalId')::int
  WHERE h.status = 'active'
    AND h.trigger_spec->>'type' = 'seed'
    AND s.fdr_q < 0.05
),

accumulating AS (
  -- pattern_summary view derive: 매트릭 합산 hit rate > 55% (>=5건), verified 중복 제외
  -- ADR-0023: catalog 카운트 대신 pattern_metrics counter (via pattern_summary view) 참조
  SELECT
    ps.user_id,
    ps.pattern_id          AS signal_id,
    ps.pattern_name        AS signal_name,
    ps.sipsin,
    ps.pattern_description AS description,
    ps.trigger_target_type,
    NULL::text             AS enum_target,
    'accumulating'::text   AS confidence_tier,
    (ps.total_hits::numeric / NULLIF(ps.total_hits + ps.total_misses, 0)) AS metric_value,
    NULL::numeric          AS fdr_q,
    NULL::date             AS evaluated_at
  FROM pattern_summary ps
  WHERE ps.active
    AND (ps.total_hits + ps.total_misses) >= 5
    AND (ps.total_hits::numeric / NULLIF(ps.total_hits + ps.total_misses, 0)) > 0.55
    AND NOT EXISTS (
      SELECT 1 FROM verified v
      WHERE v.signal_id = ps.pattern_id AND v.user_id = ps.user_id
    )
),

recent_raw AS (
  -- 지난 7일 trigger 발현 카운트
  SELECT
    m.user_id,
    m.pattern_id     AS signal_id,
    COUNT(*)         AS match_count,
    MAX(m.date)      AS last_match_date
  FROM pattern_matches m
  WHERE m.date >= CURRENT_DATE - INTERVAL '7 days'
    AND m.trigger_activated = true
  GROUP BY m.user_id, m.pattern_id
),

recent AS (
  -- recent_raw + catalog 메타, verified·accumulating 중복 제외
  SELECT
    r.user_id,
    r.signal_id,
    c.name                AS signal_name,
    c.sipsin,
    c.description,
    c.trigger_target_type,
    NULL::text            AS enum_target,
    'recent'::text        AS confidence_tier,
    r.match_count::numeric AS metric_value,
    NULL::numeric         AS fdr_q,
    r.last_match_date     AS evaluated_at
  FROM recent_raw r
  JOIN pattern_catalog c ON c.id = r.signal_id
  WHERE NOT EXISTS (
    SELECT 1 FROM verified v
    WHERE v.signal_id = r.signal_id AND v.user_id = r.user_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM accumulating a
    WHERE a.signal_id = r.signal_id AND a.user_id = r.user_id
  )
)

SELECT * FROM verified
UNION ALL
SELECT * FROM accumulating
UNION ALL
SELECT * FROM recent;

COMMENT ON VIEW saju_influence_summary IS
  '마스터 A — 사주 영향력 통합 view. confidence_tier(verified/accumulating/recent)로 신뢰도 단계 명시. weekly-saju-review-v2 Routine이 SELECT. ADR-0020 + ADR-0026 (063 rename 후 body 재정의, 컬럼 contract 유지).';
