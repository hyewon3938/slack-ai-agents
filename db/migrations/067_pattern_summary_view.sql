-- 067: pattern_summary view 신설
-- ADR-0023: 시드 단위 합계는 view로 derive (매트릭 카운터가 source of truth)
-- ADR-0024: 시드 단위 사후 확신도 = Beta 합성 가중평균
--
-- 마스터 #434 Phase 1.
-- saju_influence_summary(마스터 A)와 별개 — 본 view는 시드:매트릭 집계만.

CREATE OR REPLACE VIEW pattern_summary AS
SELECT
  c.id                                   AS pattern_id,
  c.user_id,
  c.name                                 AS pattern_name,
  c.sipsin,
  c.trigger_target_type,
  c.trigger_target_id,
  c.pattern_kind,
  c.description                          AS pattern_description,
  c.active,
  COUNT(m.id)                            AS metric_count,
  COALESCE(SUM(m.hit_count), 0)          AS total_hits,
  COALESCE(SUM(m.miss_count), 0)         AS total_misses,
  COALESCE(SUM(m.inconclusive_count), 0) AS total_inconclusive,
  MAX(m.last_matched_at)                 AS last_matched_at,
  -- 시드 단위 사후 확신도 (가중평균: Beta 합성 = sum(α) / (sum(α) + sum(β)))
  -- ADR-0024: 매트릭별 Beta-Binomial posterior를 합쳐 시드 단위 단일 확신도 산출
  CASE
    WHEN SUM(m.posterior_alpha + m.posterior_beta) > 0
    THEN SUM(m.posterior_alpha) / SUM(m.posterior_alpha + m.posterior_beta)
    ELSE NULL
  END                                    AS aggregate_posterior_p
FROM pattern_catalog c
LEFT JOIN pattern_metrics m
  ON m.pattern_id = c.id
  AND m.status = 'active'
GROUP BY c.id;

COMMENT ON VIEW pattern_summary IS
  '시드 단위 hit/miss 통계 + 사후 확신도 derive. pattern_metrics counter가 source of truth (ADR-0023). Beta 합성 = sum(alpha) / (sum(alpha)+sum(beta)) (ADR-0024).';
