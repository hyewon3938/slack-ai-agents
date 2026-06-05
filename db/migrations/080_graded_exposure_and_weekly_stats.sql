-- 080: 등급별 노출 3-tier view 재정의 + 주간 스냅샷 테이블 (#477 P3, ADR-0034·0035)
-- A. link_weekly_stats — 링크당 주 1행 스냅샷(마틴게일 trail·emerging 진행바·주간대비). 계산 입력 아님.
-- B. pattern_summary  — confirmed 링크도 집계에 포함(verified 시드가 영향력 top에서 사라지는 P2 트랩 방지).
-- C. saju_influence_summary — accumulating(off-day 누락) 제거 → verified/emerging/recent 3층 재정의.
--    verified = status='confirmed'(e≥20) / emerging = active+off-day effect leaning(검증중) / recent = 발현.
--    e_value 컬럼 추가(emerging 진행바). 컬럼 계약(앞 11개) 보존 + e_value 말미 추가(daily-insight 안전).
-- D. 정합 검증 — view 컴파일 + accumulating tier 소멸 + 스냅샷 테이블 확인(RAISE 시 파일 트랜잭션 롤백).
--
-- 소비자: saju_influence_summary 쿼리는 daily-insight SKILL(repo 밖)뿐 — 'emerging' tier 소비는
-- 배포 직후 SKILL 동기화(P2 선례). 동기화 전엔 'emerging'이 SKILL ELSE→recent로 강등(보수적, 안전).

-- ─── A. 주간 스냅샷 ───────────────────────────────────────
CREATE TABLE link_weekly_stats (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  link_id         INTEGER NOT NULL REFERENCES pattern_links(id) ON DELETE CASCADE,
  week_start      DATE NOT NULL,
  e_value         NUMERIC,
  a               INTEGER,
  b               INTEGER,
  c               INTEGER,
  d               INTEGER,
  posterior_alpha NUMERIC(8, 2),
  posterior_beta  NUMERIC(8, 2),
  p_value         NUMERIC,
  q_value         NUMERIC,
  effect          NUMERIC,
  test_type       TEXT,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (link_id, week_start)
);
CREATE INDEX idx_link_weekly_stats_link ON link_weekly_stats (link_id, week_start DESC);

COMMENT ON TABLE link_weekly_stats IS
  '링크 주간 스냅샷 (#477 P3). 주간 검증 엔진이 link당 주 1행 기록 → 마틴게일 e-value trail·emerging 진행바·주간대비 delta. 검증 진실 아님(그건 pattern_links 현재값). UNIQUE(link_id,week_start) 멱등.';

-- ─── B. pattern_summary — confirmed 포함 ──────────────────
-- 의존 view(saju_influence_summary) 먼저 DROP 후 pattern_summary 교체 → 재생성.
DROP VIEW saju_influence_summary;

CREATE OR REPLACE VIEW pattern_summary AS
SELECT c.id AS pattern_id, c.user_id, c.name AS pattern_name, c.sipsin,
       c.trigger_target_type, c.trigger_target_id, c.pattern_kind,
       c.description AS pattern_description, c.active,
       count(l.id) AS metric_count,
       COALESCE(sum(l.hit_count), 0) AS total_hits,
       COALESCE(sum(l.miss_count), 0) AS total_misses,
       COALESCE(sum(l.inconclusive_count), 0) AS total_inconclusive,
       max(l.last_matched_at) AS last_matched_at,
       CASE WHEN sum(l.posterior_alpha + l.posterior_beta) > 0
            THEN sum(l.posterior_alpha) / sum(l.posterior_alpha + l.posterior_beta)
            ELSE NULL END AS aggregate_posterior_p
FROM pattern_catalog c
LEFT JOIN pattern_links l ON l.seed_id = c.id AND l.status IN ('active', 'confirmed')
GROUP BY c.id;

COMMENT ON VIEW pattern_summary IS
  '시드 단위 검증 합계 — pattern_links(status active|confirmed) 집계 (#477 P3). verified(confirmed) 링크도 포함해 영향력 top에서 사라지지 않게(P2 보수화 후속). 컬럼 계약 v2 호환.';

-- ─── C. saju_influence_summary — 3-tier (verified/emerging/recent) ──
-- emerging 게이트 상수(1.3, 15)는 insight-thresholds.ts emergingMinEffect/emergingMinActive와 동기화.
-- (SQL view라 TS 상수 참조 불가 → 하드코딩. 튜닝 시 본 view 재정의 migration 필요 — ADR-0035 calibration.)
CREATE VIEW saju_influence_summary AS
WITH verified AS (
  SELECT c.user_id, c.id AS signal_id, c.name AS signal_name, c.sipsin,
         c.description, c.trigger_target_type,
         NULL::text AS enum_target, 'verified'::text AS confidence_tier,
         max(l.posterior_p)::numeric AS metric_value,
         min(l.q_value)::numeric AS fdr_q,
         max(l.last_matched_at::date) AS evaluated_at,
         max(l.e_value)::numeric AS e_value
  FROM pattern_catalog c
    JOIN pattern_links l ON l.seed_id = c.id AND l.status = 'confirmed'
  WHERE c.active
  GROUP BY c.id
),
emerging AS (
  SELECT c.user_id, c.id AS signal_id, c.name AS signal_name, c.sipsin,
         c.description, c.trigger_target_type,
         NULL::text AS enum_target, 'emerging'::text AS confidence_tier,
         -- 발현일 pass율(rateActive) = hit/(hit+miss). off-day 효과(effect)로 게이트(헌장 ②).
         max(l.hit_count::numeric / NULLIF(l.hit_count + l.miss_count, 0)) AS metric_value,
         min(l.q_value)::numeric AS fdr_q,
         max(l.last_matched_at::date) AS evaluated_at,
         max(l.e_value)::numeric AS e_value
  FROM pattern_catalog c
    JOIN pattern_links l ON l.seed_id = c.id AND l.status = 'active'
  WHERE c.active
    AND l.effect >= 1.3                       -- emergingMinEffect
    AND (l.hit_count + l.miss_count) >= 15     -- emergingMinActive
  GROUP BY c.id
  HAVING NOT EXISTS (
    SELECT 1 FROM pattern_links lv WHERE lv.seed_id = c.id AND lv.status = 'confirmed'
  )
),
recent_raw AS (
  SELECT m.user_id, m.pattern_id AS signal_id, count(*) AS match_count, max(m.date) AS last_match_date
  FROM seed_daily_activations m
  WHERE m.date >= (CURRENT_DATE - '7 days'::interval) AND m.trigger_activated = true
  GROUP BY m.user_id, m.pattern_id
),
recent AS (
  SELECT r.user_id, r.signal_id, c.name AS signal_name, c.sipsin, c.description, c.trigger_target_type,
         NULL::text AS enum_target, 'recent'::text AS confidence_tier,
         r.match_count::numeric AS metric_value, NULL::numeric AS fdr_q,
         r.last_match_date AS evaluated_at, NULL::numeric AS e_value
  FROM recent_raw r
    JOIN pattern_catalog c ON c.id = r.signal_id
  WHERE NOT EXISTS (SELECT 1 FROM verified v  WHERE v.signal_id = r.signal_id AND v.user_id = r.user_id)
    AND NOT EXISTS (SELECT 1 FROM emerging e  WHERE e.signal_id = r.signal_id AND e.user_id = r.user_id)
)
SELECT user_id, signal_id, signal_name, sipsin, description, trigger_target_type,
       enum_target, confidence_tier, metric_value, fdr_q, evaluated_at, e_value FROM verified
UNION ALL
SELECT user_id, signal_id, signal_name, sipsin, description, trigger_target_type,
       enum_target, confidence_tier, metric_value, fdr_q, evaluated_at, e_value FROM emerging
UNION ALL
SELECT user_id, signal_id, signal_name, sipsin, description, trigger_target_type,
       enum_target, confidence_tier, metric_value, fdr_q, evaluated_at, e_value FROM recent;

COMMENT ON VIEW saju_influence_summary IS
  '사주 영향 3층 (#477 P3, ADR-0035). verified=status confirmed(e≥20 통계 확정) / emerging=active+off-day effect≥1.3 leaning(검증중, naive accumulating 대체) / recent=최근 7일 발현(seed_daily_activations). e_value=emerging 진행바. 컬럼 계약(앞 11개) 보존 + e_value 추가. daily-insight(ADR-0031) 소비.';

-- ─── D. 정합 검증 (RAISE 시 파일 트랜잭션 롤백) ───────────
DO $$
DECLARE
  sis_rows BIGINT;
  ps_rows BIGINT;
  accum_left INT;
  has_evalue INT;
  has_table INT;
BEGIN
  -- view 컴파일 확인
  SELECT count(*) INTO sis_rows FROM saju_influence_summary;
  SELECT count(*) INTO ps_rows FROM pattern_summary;

  -- naive accumulating tier 소멸 확인 (off-day 누락 약점 제거)
  SELECT count(*) INTO accum_left FROM saju_influence_summary WHERE confidence_tier = 'accumulating';
  IF accum_left <> 0 THEN
    RAISE EXCEPTION '[080] accumulating tier 잔존 % 행 — 3-tier 재정의 실패', accum_left;
  END IF;

  -- e_value 컬럼 추가 확인
  SELECT count(*) INTO has_evalue FROM information_schema.columns
   WHERE table_name = 'saju_influence_summary' AND column_name = 'e_value';
  IF has_evalue <> 1 THEN
    RAISE EXCEPTION '[080] saju_influence_summary.e_value 컬럼 누락';
  END IF;

  -- 스냅샷 테이블 확인
  SELECT count(*) INTO has_table FROM information_schema.tables WHERE table_name = 'link_weekly_stats';
  IF has_table <> 1 THEN
    RAISE EXCEPTION '[080] link_weekly_stats 테이블 생성 실패';
  END IF;

  RAISE NOTICE '[080] 3-tier 노출 OK — saju_influence_summary % 행, pattern_summary % 행, link_weekly_stats 생성', sis_rows, ps_rows;
END $$;
