-- 083: 교란 조정 노출 — saju_influence_summary 재정의 (#477 P7, ADR-0042)
-- A. verified CTE explained_away 가드 — 조정 후 어부지리로 판정된(explainedAway=true) confirmed 링크는
--    verified 집계에서 제외. 시드는 explained_away 아닌 confirmed 링크가 ≥1개일 때만 verified 유지.
--    모든 confirmed 링크가 explained_away면 verified에서 빠짐 → recent(최근 발현 시) tier로 soft-demote.
-- B. confound_note 컬럼 추가(말미) — 각 tier 행에 그 시드의 explained_away 링크가 통제한 교란 seedName 집계
--    (없으면 NULL). daily-insight caveat 입력. 컬럼 계약(앞 12개) 보존 + confound_note 추가(소비자 안전).
-- C. 정합 검증 — view 컴파일 + confound_note 컬럼 존재 + (현재 dormant) explained_away 링크/강등 행 수 NOTICE.
--
-- e-value·status 불변(ADR-0034 결정론) — 조정은 노출 레이어에서만(ADR-0042 §3). 새 테이블 0(조정치는
-- 기존 pattern_links.confound JSONB). 데이터 게이트(nCofire≥30) 미충족이면 explained_away 0 → 뷰 무변화.
-- 소비자: saju_influence_summary 쿼리는 daily-insight SKILL(repo 밖)뿐 — confound_note 렌더는 배포 후 동기화.

DROP VIEW IF EXISTS saju_influence_summary;

-- emerging 게이트 상수(1.3, 15)는 insight-thresholds.ts emergingMinEffect/emergingMinActive와 동기화
-- (SQL view라 TS 상수 참조 불가 → 하드코딩. 튜닝 시 본 view 재정의 migration — ADR-0035 calibration).
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
                        AND (l.confound->>'explainedAway') IS DISTINCT FROM 'true'  -- P7 가드
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
),
-- 시드별 explained_away 교란 이름 — adjusted(verdict=explained_away)의 seedId를 catalog 이름으로 join.
-- 미조정·미게이트 링크는 adjusted 없음 → 행 0 → NULL(NULL-safe, 오늘과 동일).
confound_notes AS (
  SELECT l2.seed_id, string_agg(DISTINCT cc.name, ', ' ORDER BY cc.name) AS note
  FROM pattern_links l2
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(l2.confound->'adjusted', '[]'::jsonb)) AS adj
    JOIN pattern_catalog cc ON cc.id = (adj->>'seedId')::int
  WHERE (l2.confound->>'explainedAway') = 'true'
    AND (adj->>'verdict') = 'explained_away'
  GROUP BY l2.seed_id
)
SELECT t.user_id, t.signal_id, t.signal_name, t.sipsin, t.description, t.trigger_target_type,
       t.enum_target, t.confidence_tier, t.metric_value, t.fdr_q, t.evaluated_at, t.e_value,
       n.note AS confound_note
FROM (
  SELECT * FROM verified
  UNION ALL
  SELECT * FROM emerging
  UNION ALL
  SELECT * FROM recent
) t
LEFT JOIN confound_notes n ON n.seed_id = t.signal_id;

COMMENT ON VIEW saju_influence_summary IS
  '사주 영향 3층 (#477 P3 ADR-0035, P7 ADR-0042). verified=status confirmed(e≥20) 중 explained_away 아닌 링크 보유 / emerging=active+off-day effect≥1.3 leaning(검증중) / recent=최근 7일 발현. confound_note=교란 조정으로 어부지리 판정된 교란 seedName(daily-insight caveat). e_value=emerging 진행바. 컬럼 계약(앞 12개) 보존 + confound_note 추가.';

-- ─── C. 정합 검증 (RAISE 시 파일 트랜잭션 롤백) ───────────
DO $$
DECLARE
  sis_rows BIGINT;
  has_note INT;
  ea_links INT;
  noted_rows INT;
BEGIN
  -- view 컴파일 확인
  SELECT count(*) INTO sis_rows FROM saju_influence_summary;

  -- confound_note 컬럼 추가 확인
  SELECT count(*) INTO has_note FROM information_schema.columns
   WHERE table_name = 'saju_influence_summary' AND column_name = 'confound_note';
  IF has_note <> 1 THEN
    RAISE EXCEPTION '[083] saju_influence_summary.confound_note 컬럼 누락';
  END IF;

  -- dormant 확인(정보성) — 현재 데이터 게이트(nCofire≥30) 미충족이면 explained_away 0 = 강등 0행.
  -- 데이터 누적 후 자동 활성되면 0이 아니어도 정상(RAISE 안 함).
  SELECT count(*) INTO ea_links FROM pattern_links WHERE confound->>'explainedAway' = 'true';
  SELECT count(*) INTO noted_rows FROM saju_influence_summary WHERE confound_note IS NOT NULL;

  RAISE NOTICE '[083] 교란 조정 노출 OK — saju_influence_summary % 행, explained_away 링크 %, caveat 행 % (dormant 예상 0/0)',
    sis_rows, ea_links, noted_rows;
END $$;
