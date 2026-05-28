-- 071: 마스터 #434 Phase 2.5 — 사주 시드 운 레벨 차원 도입 + 14개 신규 시드
-- ADR-0028: 운 레벨 + 풀셋 임계치 + 임의값 배제
--
-- 변경:
--   1) pattern_catalog.pillar_level 컬럼 추가 (사주 시드 전용)
--   2) Phase 2 사주 시드 161개 backfill: pillar_level='ilun' (기존 시드는 일운 발현)
--   3) trigger_target_type CHECK에 'cumulative_pillar_count' 추가
--   4) pattern_metrics.domain CHECK에 'expense_category_present' 추가 (cross-domain)
--   5) 14개 신규 시드 INSERT (편재 9 + 화 오행 5)
--      - 편재 천간(갑) 일운·월운 2개
--      - 편재 지지(인) 일운·월운 2개
--      - 편재 누적 N=1..5 (sipsin 기준) 5개
--      - 화 오행 누적 N=1..5 (element 기준) 5개 + 각 시드에 매트릭 2개 (OR 매칭)
--
-- 임의 임계치·가중치는 박지 않음. 풀셋(N=1..5)으로 데이터가 결정 (ADR-0028).
-- 자동 분포 cron(월요일 09:15 KST)이 데이터 누적 후 임계치 추출 트리거 노출.

BEGIN;

-- 1) pillar_level 컬럼 (사주 시드 전용, life_signal/null은 미적용)
ALTER TABLE pattern_catalog
  ADD COLUMN pillar_level VARCHAR(20)
  CHECK (
    pillar_level IS NULL OR pillar_level IN ('wonguk', 'daeun', 'seun', 'wolun', 'ilun', 'cumulative')
  );

COMMENT ON COLUMN pattern_catalog.pillar_level IS
  '사주 시드 발현 운 레벨 (wonguk/daeun/seun/wolun/ilun/cumulative). life_signal/null은 미적용. ADR-0028';

-- 2) Phase 2 사주 시드 backfill: 모두 ilun 차원으로 설정
UPDATE pattern_catalog
  SET pillar_level = 'ilun'
  WHERE pattern_kind = 'saju' AND source = 'seed' AND pillar_level IS NULL;

-- 3) trigger_target_type CHECK 확장 — 'cumulative_pillar_count' 추가
ALTER TABLE pattern_catalog
  DROP CONSTRAINT pattern_catalog_trigger_target_type_check;
ALTER TABLE pattern_catalog
  ADD CONSTRAINT pattern_catalog_trigger_target_type_check
  CHECK (trigger_target_type IN (
    'stem', 'branch', 'ganji', 'element_density', 'sibiunsung', 'relation',
    'cumulative_pillar_count',  -- Phase 2.5 신규
    'life_signal'
  ));

-- 4) pattern_metrics.domain CHECK 확장 — 'expense_category_present' 추가
-- cross-domain 메트릭 식별자 (사주 trigger × 다른 도메인 발현 카운트)
-- saju_signal_metrics → pattern_metrics rename으로 인해 기존 제약명 두 경우 모두 처리
ALTER TABLE pattern_metrics
  DROP CONSTRAINT IF EXISTS saju_signal_metrics_domain_check;
ALTER TABLE pattern_metrics
  DROP CONSTRAINT IF EXISTS pattern_metrics_domain_check;
ALTER TABLE pattern_metrics
  ADD CONSTRAINT pattern_metrics_domain_check
  CHECK (domain IN (
    'schedule', 'routine', 'sleep', 'expense', 'diary_meta', 'audit',
    'expense_category_present'  -- Phase 2.5 신규
  ));

-- 5) 인덱스 — 분포 cron의 GROUP BY pillar_level 가속
CREATE INDEX IF NOT EXISTS idx_pattern_catalog_pillar_level
  ON pattern_catalog (pillar_level) WHERE pattern_kind = 'saju';

-- ── 6) 14개 신규 시드 INSERT ──────────────────────────────────────

-- 6-1) 편재 천간(갑) — 일운·월운 2개
DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT id INTO t_id FROM stems_master WHERE name='갑';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux,
     pillar_level, pattern_kind, source, active)
  VALUES
    (1, 'pool_편재_갑_천간_일운', '편재',
     $d$갑목 천간 일운 — 편재 (천간 발현 체감 vs 지지 비교용)$d$,
     'stem', t_id, NULL, 'ilun', 'saju', 'seed', true),
    (1, 'pool_편재_갑_천간_월운', '편재',
     $d$갑목 천간 월운 — 편재 (한 달 단위 발현 가설)$d$,
     'stem', t_id, NULL, 'wolun', 'saju', 'seed', true)
  ON CONFLICT (user_id, name) DO NOTHING;
END $$;

-- 6-2) 편재 지지(인) — 일운·월운 2개
DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT id INTO t_id FROM branches_master WHERE name='인';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux,
     pillar_level, pattern_kind, source, active)
  VALUES
    (1, 'pool_편재_인_지지_일운', '편재',
     $d$인목 지지 일운 — 편재 (지지 발현 체감, 천간 비교)$d$,
     'branch', t_id, NULL, 'ilun', 'saju', 'seed', true),
    (1, 'pool_편재_인_지지_월운', '편재',
     $d$인목 지지 월운 — 편재 (저변 기운 한 달 단위)$d$,
     'branch', t_id, NULL, 'wolun', 'saju', 'seed', true)
  ON CONFLICT (user_id, name) DO NOTHING;
END $$;

-- 6-3) 편재 누적 N=1..5 — 5개 (sipsin 기준, 5개 운 레벨 중 발현 수)
INSERT INTO pattern_catalog
  (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux,
   pillar_level, pattern_kind, source, active)
VALUES
  (1, 'pool_편재_누적_N1', '편재',
   '편재 누적 1개 이상 (5개 운 레벨 중) — 풀셋 임계치 (ADR-0028)',
   'cumulative_pillar_count', NULL, '{"sipsin":"편재","count_min":1}'::jsonb,
   'cumulative', 'saju', 'seed', true),
  (1, 'pool_편재_누적_N2', '편재',
   '편재 누적 2개 이상 — 풀셋 임계치',
   'cumulative_pillar_count', NULL, '{"sipsin":"편재","count_min":2}'::jsonb,
   'cumulative', 'saju', 'seed', true),
  (1, 'pool_편재_누적_N3', '편재',
   '편재 누적 3개 이상 — 풀셋 임계치',
   'cumulative_pillar_count', NULL, '{"sipsin":"편재","count_min":3}'::jsonb,
   'cumulative', 'saju', 'seed', true),
  (1, 'pool_편재_누적_N4', '편재',
   '편재 누적 4개 이상 — 풀셋 임계치',
   'cumulative_pillar_count', NULL, '{"sipsin":"편재","count_min":4}'::jsonb,
   'cumulative', 'saju', 'seed', true),
  (1, 'pool_편재_누적_N5', '편재',
   '편재 누적 5개 (전 레벨) — 풀셋 임계치',
   'cumulative_pillar_count', NULL, '{"sipsin":"편재","count_min":5}'::jsonb,
   'cumulative', 'saju', 'seed', true)
ON CONFLICT (user_id, name) DO NOTHING;

-- 6-4) 화 오행 누적 N=1..5 — 5개 (element 기준)
INSERT INTO pattern_catalog
  (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux,
   pillar_level, pattern_kind, source, active)
VALUES
  (1, 'pool_화_오행_누적_N1', NULL,
   '화 오행 누적 1개 이상 (5개 운 레벨 중) — 화극금 건강 가설 (ADR-0028 풀셋 임계치)',
   'cumulative_pillar_count', NULL, '{"element":"화","count_min":1}'::jsonb,
   'cumulative', 'saju', 'seed', true),
  (1, 'pool_화_오행_누적_N2', NULL,
   '화 오행 누적 2개 이상 — 풀셋 임계치',
   'cumulative_pillar_count', NULL, '{"element":"화","count_min":2}'::jsonb,
   'cumulative', 'saju', 'seed', true),
  (1, 'pool_화_오행_누적_N3', NULL,
   '화 오행 누적 3개 이상 — 풀셋 임계치',
   'cumulative_pillar_count', NULL, '{"element":"화","count_min":3}'::jsonb,
   'cumulative', 'saju', 'seed', true),
  (1, 'pool_화_오행_누적_N4', NULL,
   '화 오행 누적 4개 이상 — 풀셋 임계치',
   'cumulative_pillar_count', NULL, '{"element":"화","count_min":4}'::jsonb,
   'cumulative', 'saju', 'seed', true),
  (1, 'pool_화_오행_누적_N5', NULL,
   '화 오행 누적 5개 (전 레벨) — 풀셋 임계치',
   'cumulative_pillar_count', NULL, '{"element":"화","count_min":5}'::jsonb,
   'cumulative', 'saju', 'seed', true)
ON CONFLICT (user_id, name) DO NOTHING;

-- 6-5) 화 오행 누적 시드 매트릭 (각 시드에 2개씩 OR 매칭)
-- 매트릭 둘 중 하나만 hit이어도 시드 hit (saju-match.ts metricEvaluations.some 로직)
DO $$
DECLARE seed_id INTEGER;
BEGIN
  FOR seed_id IN
    SELECT id FROM pattern_catalog
    WHERE name LIKE 'pool_화_오행_누적_N%' AND user_id = 1
  LOOP
    INSERT INTO pattern_metrics
      (pattern_id, metric_name, expected_metric_sql, expected_direction, expected_threshold,
       domain, description, status, window_days)
    VALUES
      (seed_id, 'diary_health_complaint',
       $sql$SELECT COUNT(*) FROM diary_meta_tags WHERE user_id=$1 AND date=$2 AND tag='health_complaint'$sql$,
       'flag_present', 1, 'diary_meta',
       '당일 일기에 건강 불편 호소 enum 발현 — 화극금 건강 가설',
       'active', 1),
      (seed_id, 'expense_의료건강',
       $sql$SELECT COUNT(*) FROM expenses WHERE user_id=$1 AND date=$2 AND type='expense' AND category='의료/건강'$sql$,
       'flag_present', 1, 'expense_category_present',
       '당일 의료/건강 카테고리 지출 발생 — cross-domain 검증',
       'active', 1)
    ON CONFLICT (pattern_id, metric_name) DO NOTHING;
  END LOOP;
END $$;

-- ── 7) cron 슬롯 시드 ─────────────────────────────────────
-- 매일 09:15 발송이지만 cron 본체가 월요일 외 return — weeklyHypothesisReview와 동일 패턴.
INSERT INTO notification_settings (slot_name, time_value, label, active)
  VALUES ('pillarLevelDistributionReview', '09:15', '운 레벨 분포 분석', true)
  ON CONFLICT (slot_name) DO NOTHING;

COMMIT;
