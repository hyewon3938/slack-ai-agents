-- 061: 사주 영향력 통합 view (마스터 A — 사주 풀이 시스템 책임 분리)
-- ADR-0020 참조: docs/adr/0020-fortune-system-responsibility-split-via-view.md
--
-- 3개 소스를 UNION ALL로 통합:
--   verified     — Phase 4 hypothesis가 BH-FDR 통과한 시드 (fdr_q < 0.05)
--   accumulating — Phase 3 catalog hit/miss 누적 hit rate > 55% (>=5건)
--   recent       — 지난 7일 trigger 발현 매칭 카운트
--
-- 중복 dedup: verified > accumulating > recent (한 signal_id가 verified에 있으면
-- accumulating·recent에서 제외, accumulating에 있으면 recent에서 제외).
--
-- 사용처: weekly-saju-review-v2 Routine (Phase A1). DB Proxy API를 통해 SELECT.

CREATE OR REPLACE VIEW saju_influence_summary AS
WITH latest_stats AS (
  -- 가설별 가장 최근 주간 통계만 추출
  SELECT DISTINCT ON (hypothesis_id)
    hypothesis_id,
    week_start,
    rate_ratio,
    fdr_q
  FROM saju_stats
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
  FROM saju_hypotheses h
  JOIN latest_stats s
    ON s.hypothesis_id = h.id
  JOIN saju_signal_catalog c
    ON c.id = (h.trigger_spec->>'signalId')::int
  WHERE h.status = 'active'
    AND h.trigger_spec->>'type' = 'seed'
    AND s.fdr_q < 0.05
),

accumulating AS (
  -- catalog 누적 hit rate > 55% (>=5건), verified와 중복 제외
  SELECT
    c.user_id,
    c.id                  AS signal_id,
    c.name                AS signal_name,
    c.sipsin,
    c.description,
    c.trigger_target_type,
    NULL::text            AS enum_target,
    'accumulating'::text  AS confidence_tier,
    (c.hit_count::numeric / NULLIF(c.hit_count + c.miss_count, 0)) AS metric_value,
    NULL::numeric         AS fdr_q,
    NULL::date            AS evaluated_at
  FROM saju_signal_catalog c
  WHERE c.active
    AND (c.hit_count + c.miss_count) >= 5
    AND (c.hit_count::numeric / NULLIF(c.hit_count + c.miss_count, 0)) > 0.55
    AND NOT EXISTS (
      SELECT 1 FROM verified v
      WHERE v.signal_id = c.id AND v.user_id = c.user_id
    )
),

recent_raw AS (
  -- 지난 7일 trigger 발현 카운트
  SELECT
    m.user_id,
    m.signal_id,
    COUNT(*)        AS match_count,
    MAX(m.date)     AS last_match_date
  FROM saju_daily_matches m
  WHERE m.date >= CURRENT_DATE - INTERVAL '7 days'
    AND m.trigger_activated = true
  GROUP BY m.user_id, m.signal_id
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
  JOIN saju_signal_catalog c ON c.id = r.signal_id
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
  '마스터 A — 사주 영향력 통합 view. confidence_tier(verified/accumulating/recent)로 신뢰도 단계 명시. weekly-saju-review-v2 Routine이 SELECT. ADR-0020 참조.';
