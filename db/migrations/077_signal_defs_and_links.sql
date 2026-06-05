-- 077: 패턴 검증 스키마 재설계 + 신호 전역화 (#477 P1, ADR-0032·0033)
-- A. signal_defs   — 전역 신호 정의 (kind=sql|tag). 시드와 무관한 측정 가능 정의.
-- B. pattern_links — (시드 × 신호) = 가설 + 누적 검증상태. seed_id × signal_id 단위.
-- C. 이관 — pattern_metrics → signal_defs(49 sql + 22 tag) + pattern_links(84, counters 1:1).
-- D. 이관 정합 검증 — pattern_metrics DROP 전 대조 (불일치 시 RAISE → 파일 전체 암묵 트랜잭션 롤백).
-- E. view 재정의 — pattern_summary(링크 기반) + saju_influence_summary(verified tier 제거).
-- F. 폐기 — pattern_hypotheses·pattern_stats·pattern_metrics DROP.
--          pattern_matches는 P2까지 유지(daily-insight #insight recent tier가 의존, ADR-0031).
--          archive·transient 전환은 주간 검증 엔진(P2)과 함께 처리.

-- ─── A. signal_defs ──────────────────────────────────────
CREATE TABLE signal_defs (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('sql', 'tag')),
  -- sql kind 필드 --
  sql_body      TEXT,
  value_type    TEXT CHECK (value_type IN ('binary', 'continuous')),
  direction     TEXT CHECK (direction IN ('above_avg', 'below_avg', 'above_abs', 'below_abs', 'flag_present')),
  threshold     NUMERIC,
  domain        TEXT CHECK (domain IN ('schedule', 'routine', 'sleep', 'expense', 'diary_meta', 'audit', 'expense_category_present')),
  window_days   INTEGER,
  -- tag kind 필드 --
  tag_name      TEXT,
  -- 공통 --
  description   TEXT NOT NULL DEFAULT '',
  source        TEXT NOT NULL DEFAULT 'seed' CHECK (source IN ('seed', 'llm')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'rejected')),
  proposed_at   TIMESTAMPTZ,
  approved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT signal_defs_sql_fields CHECK (
    kind <> 'sql' OR (sql_body IS NOT NULL AND value_type IS NOT NULL AND direction IS NOT NULL)
  ),
  CONSTRAINT signal_defs_tag_fields CHECK (kind <> 'tag' OR tag_name IS NOT NULL),
  -- 이관용 임시 추적 컬럼 (F에서 DROP) --
  _legacy_metric_id INTEGER
);
-- tag 신호는 (user, tag) 단위 전역 1개 — 여러 시드가 공유
CREATE UNIQUE INDEX uq_signal_defs_tag ON signal_defs (user_id, tag_name) WHERE kind = 'tag';
CREATE INDEX idx_signal_defs_status_active ON signal_defs (status) WHERE status = 'active';

COMMENT ON TABLE signal_defs IS
  '전역 신호 정의 (#477 ADR-0033). kind=sql(객관 SQL 측정, 1차) | tag(일기 메타 태그, 보조). 시드와 무관하게 매일 측정 가능. value_type=binary|continuous, direction은 off-day 대조 판정 기준. source=llm은 자율 발견 신호. tag 신호는 (user, tag) 전역 1개를 여러 시드가 pattern_links로 공유.';
COMMENT ON COLUMN signal_defs._legacy_metric_id IS
  '이관 추적용 임시 컬럼 — 077 마이그레이션 종료 시 DROP. 운영 중 존재하면 안 됨.';

-- ─── B. pattern_links ────────────────────────────────────
CREATE TABLE pattern_links (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seed_id         INTEGER NOT NULL REFERENCES pattern_catalog(id) ON DELETE CASCADE,
  signal_id       INTEGER NOT NULL REFERENCES signal_defs(id) ON DELETE CASCADE,
  source          TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'discovery', 'llm')),
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'pending', 'weak', 'confirmed', 'rejected', 'archived')),
  -- 누적 검증상태 (이관) --
  hit_count          INTEGER NOT NULL DEFAULT 0,
  miss_count         INTEGER NOT NULL DEFAULT 0,
  inconclusive_count INTEGER NOT NULL DEFAULT 0,
  last_matched_at    TIMESTAMPTZ,
  posterior_alpha    NUMERIC(8, 2) NOT NULL DEFAULT 1.0,
  posterior_beta     NUMERIC(8, 2) NOT NULL DEFAULT 1.0,
  posterior_p        NUMERIC(6, 4),
  -- 검증결과 (P2 주간 엔진 / P3 통계 증강이 채움 — P1에선 NULL 선언만) --
  test_type       TEXT CHECK (test_type IN ('fisher_2x2', 'mann_whitney')),
  effect          NUMERIC,
  p_value         NUMERIC(10, 8),
  q_value         NUMERIC(10, 8),
  e_value         NUMERIC,
  test_detail     JSONB,
  confound        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (seed_id, signal_id)
);
CREATE INDEX idx_pattern_links_seed ON pattern_links (seed_id) WHERE status = 'active';
CREATE INDEX idx_pattern_links_signal ON pattern_links (signal_id);

COMMENT ON TABLE pattern_links IS
  '(시드 × 신호) 등록 = 검증 대상 가설 (#477 ADR-0033, 별도 가설 엔티티 폐기). 누적 검증상태(hit/miss/posterior) + 검증결과(test_type·effect·p·q·e_value·test_detail·confound) 보유. status=pending은 LLM 자율 제안 미승인 가설(매칭 제외). e_value·test_detail·confound·test_type 컬럼은 P1에서 선언만, 로직은 P2/P3.';

-- ─── C. 이관 ─────────────────────────────────────────────
-- C-1. sql 신호 (49, 1:1). status·source는 매트릭 보존(pending llm sql은 pending 유지).
INSERT INTO signal_defs (user_id, name, kind, sql_body, value_type, direction, threshold,
                         domain, window_days, description, source, status,
                         proposed_at, approved_at, _legacy_metric_id)
SELECT c.user_id, m.metric_name, 'sql', m.expected_metric_sql,
       CASE WHEN m.expected_direction = 'flag_present' THEN 'binary' ELSE 'continuous' END,
       m.expected_direction, m.expected_threshold, m.domain, m.window_days, m.description,
       CASE m.source WHEN 'llm_autonomous' THEN 'llm' ELSE 'seed' END,
       m.status, m.proposed_at, m.approved_at, m.id
FROM pattern_metrics m
  JOIN pattern_catalog c ON c.id = m.pattern_id
WHERE m.domain <> 'diary_meta';

-- C-2. tag 신호 (22). 객관 전역 detection이라 항상 active·seed. 여러 시드가 공유.
INSERT INTO signal_defs (user_id, name, kind, value_type, domain, tag_name, description, source, status)
SELECT DISTINCT user_id, tag, 'tag', 'binary', 'diary_meta', tag, '', 'seed', 'active'
FROM diary_meta_tags;

-- C-3. sql 링크 (49). _legacy_metric_id로 1:1. pending 매트릭 → pending 링크(매칭 제외).
INSERT INTO pattern_links (user_id, seed_id, signal_id, source, status,
                           hit_count, miss_count, inconclusive_count, last_matched_at,
                           posterior_alpha, posterior_beta, posterior_p)
SELECT c.user_id, m.pattern_id, s.id,
       CASE m.source WHEN 'llm_autonomous' THEN 'llm' ELSE 'manual' END,
       CASE WHEN m.status = 'active' THEN 'active' ELSE 'pending' END,
       m.hit_count, m.miss_count, m.inconclusive_count, m.last_matched_at,
       m.posterior_alpha, m.posterior_beta, m.posterior_p
FROM pattern_metrics m
  JOIN pattern_catalog c ON c.id = m.pattern_id
  JOIN signal_defs s ON s._legacy_metric_id = m.id
WHERE m.domain <> 'diary_meta';

-- C-4. tag 링크 (35). diary 매트릭 SQL의 tag='X' 추출 → tag 신호 매칭. counters 1:1 복사.
INSERT INTO pattern_links (user_id, seed_id, signal_id, source, status,
                           hit_count, miss_count, inconclusive_count, last_matched_at,
                           posterior_alpha, posterior_beta, posterior_p)
SELECT c.user_id, m.pattern_id, s.id,
       CASE m.source WHEN 'llm_autonomous' THEN 'llm' ELSE 'manual' END,
       CASE WHEN m.status = 'active' THEN 'active' ELSE 'pending' END,
       m.hit_count, m.miss_count, m.inconclusive_count, m.last_matched_at,
       m.posterior_alpha, m.posterior_beta, m.posterior_p
FROM pattern_metrics m
  JOIN pattern_catalog c ON c.id = m.pattern_id
  JOIN signal_defs s
    ON s.kind = 'tag'
   AND s.user_id = c.user_id
   AND s.tag_name = substring(m.expected_metric_sql FROM 'tag\s*=\s*''?([a-z_]+)')
WHERE m.domain = 'diary_meta';

-- ─── D. 이관 정합 검증 (pattern_metrics DROP 전 대조, 데이터 독립) ──────
DO $$
DECLARE
  exp_sql INT; got_sql INT;
  exp_tag INT; got_tag_sig INT; got_tag_link INT;
  exp_links INT; got_links INT;
  pm_hit BIGINT; pl_hit BIGINT; pm_miss BIGINT; pl_miss BIGINT; pm_inc BIGINT; pl_inc BIGINT;
BEGIN
  -- sql 신호 = non-diary 매트릭 수
  SELECT count(*) INTO exp_sql FROM pattern_metrics WHERE domain <> 'diary_meta';
  SELECT count(*) INTO got_sql FROM signal_defs WHERE kind = 'sql';
  IF got_sql <> exp_sql THEN
    RAISE EXCEPTION 'sql 신호 수 불일치: 매트릭 %, signal_defs %', exp_sql, got_sql;
  END IF;

  -- tag 신호 = diary_meta_tags distinct tag
  SELECT count(DISTINCT tag) INTO exp_tag FROM diary_meta_tags;
  SELECT count(*) INTO got_tag_sig FROM signal_defs WHERE kind = 'tag';
  IF got_tag_sig <> exp_tag THEN
    RAISE EXCEPTION 'tag 신호 수 불일치: distinct tag %, signal_defs %', exp_tag, got_tag_sig;
  END IF;

  -- tag 링크 = diary 매트릭 수 (전부 형성됐는지)
  SELECT count(*) INTO got_tag_link
  FROM pattern_links pl JOIN signal_defs s ON s.id = pl.signal_id WHERE s.kind = 'tag';
  IF got_tag_link <> (SELECT count(*) FROM pattern_metrics WHERE domain = 'diary_meta') THEN
    RAISE EXCEPTION 'tag 링크 수 불일치: diary 매트릭 %, tag 링크 %',
      (SELECT count(*) FROM pattern_metrics WHERE domain = 'diary_meta'), got_tag_link;
  END IF;

  -- 총 링크 = 총 매트릭 (1:1)
  SELECT count(*) INTO exp_links FROM pattern_metrics;
  SELECT count(*) INTO got_links FROM pattern_links;
  IF got_links <> exp_links THEN
    RAISE EXCEPTION '링크 총수 불일치: 매트릭 %, 링크 %', exp_links, got_links;
  END IF;

  -- 카운터 합 보존 (hit/miss/inconclusive)
  SELECT COALESCE(sum(hit_count), 0), COALESCE(sum(miss_count), 0), COALESCE(sum(inconclusive_count), 0)
    INTO pm_hit, pm_miss, pm_inc FROM pattern_metrics;
  SELECT COALESCE(sum(hit_count), 0), COALESCE(sum(miss_count), 0), COALESCE(sum(inconclusive_count), 0)
    INTO pl_hit, pl_miss, pl_inc FROM pattern_links;
  IF pl_hit <> pm_hit OR pl_miss <> pm_miss OR pl_inc <> pm_inc THEN
    RAISE EXCEPTION '카운터 합 불일치: 매트릭 %/%/%　링크 %/%/%',
      pm_hit, pm_miss, pm_inc, pl_hit, pl_miss, pl_inc;
  END IF;

  RAISE NOTICE '[077] 이관 정합 OK — sql 신호 %, tag 신호 %, 링크 % (hit/miss/inc %/%/%)',
    got_sql, got_tag_sig, got_links, pl_hit, pl_miss, pl_inc;
END $$;

-- ─── E. view 재정의 ──────────────────────────────────────
-- saju_influence_summary가 pattern_summary에 의존 → 의존 view 먼저 DROP
DROP VIEW saju_influence_summary;
DROP VIEW pattern_summary;

-- pattern_summary — pattern_links 기반 (컬럼명·순서·타입 보존, ADR-0023 시드 합계 derive)
CREATE VIEW pattern_summary AS
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
LEFT JOIN pattern_links l ON l.seed_id = c.id AND l.status = 'active'
GROUP BY c.id;

COMMENT ON VIEW pattern_summary IS
  '시드 단위 검증 합계 — pattern_links(status=active) 집계 (#477 P1, ADR-0023). hit/miss/inconclusive 합·aggregate posterior를 derive. 컬럼 계약은 v2 시절과 동일 유지(weekly-report·fast-path·saju_influence_summary 호환).';

-- saju_influence_summary — verified tier(가설/통계, 0행이었음) 제거.
-- accumulating(new pattern_summary) + recent(pattern_matches 유지, ADR-0031 daily-insight) 2층.
CREATE VIEW saju_influence_summary AS
WITH accumulating AS (
  SELECT ps.user_id,
         ps.pattern_id AS signal_id,
         ps.pattern_name AS signal_name,
         ps.sipsin,
         ps.pattern_description AS description,
         ps.trigger_target_type,
         NULL::text AS enum_target,
         'accumulating'::text AS confidence_tier,
         ps.total_hits::numeric / NULLIF(ps.total_hits + ps.total_misses, 0)::numeric AS metric_value,
         NULL::numeric AS fdr_q,
         NULL::date AS evaluated_at
  FROM pattern_summary ps
  WHERE ps.active
    AND (ps.total_hits + ps.total_misses) >= 5
    AND (ps.total_hits::numeric / NULLIF(ps.total_hits + ps.total_misses, 0)::numeric) > 0.55
),
recent_raw AS (
  SELECT m.user_id, m.pattern_id AS signal_id, count(*) AS match_count, max(m.date) AS last_match_date
  FROM pattern_matches m
  WHERE m.date >= (CURRENT_DATE - '7 days'::interval) AND m.trigger_activated = true
  GROUP BY m.user_id, m.pattern_id
),
recent AS (
  SELECT r.user_id, r.signal_id, c.name AS signal_name, c.sipsin, c.description, c.trigger_target_type,
         NULL::text AS enum_target, 'recent'::text AS confidence_tier,
         r.match_count::numeric AS metric_value, NULL::numeric AS fdr_q, r.last_match_date AS evaluated_at
  FROM recent_raw r
    JOIN pattern_catalog c ON c.id = r.signal_id
  WHERE NOT EXISTS (
    SELECT 1 FROM accumulating a WHERE a.signal_id = r.signal_id AND a.user_id = r.user_id
  )
)
SELECT user_id, signal_id, signal_name, sipsin, description, trigger_target_type,
       enum_target, confidence_tier, metric_value, fdr_q, evaluated_at
FROM accumulating
UNION ALL
SELECT user_id, signal_id, signal_name, sipsin, description, trigger_target_type,
       enum_target, confidence_tier, metric_value, fdr_q, evaluated_at
FROM recent;

COMMENT ON VIEW saju_influence_summary IS
  '사주 영향 3층 → P1에서 2층(accumulating·recent). verified tier(가설×통계)는 #477 P1에서 폐기(0행) — P2 주간 엔진이 pattern_links confirmed로 복원 예정. recent는 pattern_matches 최근 7일 trigger(ADR-0031 daily-insight 의존). 컬럼 계약 보존.';

-- ─── F. 폐기 (pattern_matches는 P2까지 유지) ──────────────
-- pattern_stats가 pattern_hypotheses로 FK 보유 → stats 먼저 DROP.
DROP TABLE pattern_stats;
DROP TABLE pattern_hypotheses;
DROP TABLE pattern_metrics;
ALTER TABLE signal_defs DROP COLUMN _legacy_metric_id;
