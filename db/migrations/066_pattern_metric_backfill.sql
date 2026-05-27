-- 066: 결정론 매트릭 description placeholder + catalog→metric 카운트 이전
-- 마스터 #434 Phase 1.
-- ADR-0023: hit/miss source of truth를 catalog → metric으로 이전
-- ADR-0024: Beta(1+hit, 1+miss) 초기화
--
-- 정합성 우선: catalog의 누적 카운트를 그대로 metric에 분배하면 시드 1:N 매트릭일 때
-- 분배 모호. pattern_matches raw에서 매트릭 단위로 재집계하는 것이 정확.
-- v2 현 구조에서는 시드:매칭 1:1이므로 verify_status를 그대로 매트릭에 반영해도 정확하며,
-- 시드 1:N 매트릭이 발생하는 Phase 5+부터는 매칭 단계에서 매트릭별 verify_status를 기록.

BEGIN;

-- 6a. 결정론 매트릭 description placeholder
--   Phase 2에서 사주 시드 풀 셋 검토 시 수동 보강 (본 단계는 NOT NULL CHECK 통과가 목적)
UPDATE pattern_metrics m
SET description = CONCAT(
  c.name, ' 시드의 ',
  COALESCE(m.metric_name, '기본 매트릭'), ' 평가 (',
  c.trigger_target_type, ')'
)
FROM pattern_catalog c
WHERE m.pattern_id = c.id
  AND m.description = ''
  AND m.source = 'deterministic';

-- 6b. catalog → metric 카운트 이전 (pattern_matches raw에서 매트릭 단위 재집계)
UPDATE pattern_metrics m
SET hit_count          = COALESCE(stats.hit, 0),
    miss_count         = COALESCE(stats.miss, 0),
    inconclusive_count = COALESCE(stats.incon, 0),
    last_matched_at    = stats.last_at,
    -- Bayesian alpha/beta 초기화: Beta(1+hit, 1+miss). inconclusive는 갱신 안 함.
    posterior_alpha    = 1.0 + COALESCE(stats.hit, 0),
    posterior_beta     = 1.0 + COALESCE(stats.miss, 0),
    posterior_p        = CASE
      WHEN COALESCE(stats.hit, 0) + COALESCE(stats.miss, 0) = 0 THEN NULL
      ELSE (1.0 + COALESCE(stats.hit, 0)) /
           (2.0 + COALESCE(stats.hit, 0) + COALESCE(stats.miss, 0))
    END
FROM (
  -- pattern_matches는 시드 단위 1행 (metric_values JSONB로 매트릭별 결과 보관 가능)
  -- 시드:매칭 1:1인 현 구조에서는 verify_status가 시드 = 매트릭 결과와 일치
  SELECT
    pm.id AS metric_id,
    COUNT(*) FILTER (WHERE mt.verify_status = 'hit')          AS hit,
    COUNT(*) FILTER (WHERE mt.verify_status = 'miss')         AS miss,
    COUNT(*) FILTER (WHERE mt.verify_status = 'inconclusive') AS incon,
    MAX(mt.created_at) FILTER (WHERE mt.verify_status IN ('hit','miss','inconclusive')) AS last_at
  FROM pattern_metrics pm
  LEFT JOIN pattern_matches mt ON mt.pattern_id = pm.pattern_id
  GROUP BY pm.id
) stats
WHERE m.id = stats.metric_id;

-- 6c. catalog의 hit/miss 카운트 deprecation marker
--   컬럼은 잔존하되 후속 코드는 metric counter만 참조 (ADR-0023)
COMMENT ON COLUMN pattern_catalog.hit_count IS
  'DEPRECATED (ADR-0023). pattern_metrics.hit_count가 source of truth. 본 컬럼은 v2 운영 호환을 위해 유지';
COMMENT ON COLUMN pattern_catalog.miss_count IS
  'DEPRECATED (ADR-0023). pattern_metrics.miss_count 참조';
COMMENT ON COLUMN pattern_catalog.inconclusive_count IS
  'DEPRECATED (ADR-0023). pattern_metrics.inconclusive_count 참조';

COMMIT;
