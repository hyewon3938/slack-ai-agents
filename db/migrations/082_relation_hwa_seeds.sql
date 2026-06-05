-- 082: 결정론 사주 관계·합화 변환 feature 엔진 — #477 P4b (ADR-0038)
-- A. relation_type CHECK 확장 (귀문·암합)
-- B. trigger_target_type CHECK 확장 (hwa_sipsung)
-- C. 귀문 6쌍 + 대표 암합 4쌍 → branch_relations
-- D. auto-gen 관계 시드 (귀문·암합, 070 LOOP 패턴) — evidence-only(매트릭 없음, 휴면/누적)
-- E. 효과적 십성 시드 5개 (hwa_sipsung) — 합화 변환 후 化 오행의 일간 대비 십성
-- F. 큐레이트 링크 10 — 효과적 십성 × 객관 신호 (양의 연관, off-day 검증 시작)
-- G. 정합 검증 (RAISE 시 파일 트랜잭션 롤백)
--
-- 합화 변환 자체는 TS(saju-hwa.ts)에서 결정론 계산 — 합화오행은 TS 상수(CHEONGAN_HAP/JIJI_*)에
-- 이미 있어 DB 데이터 추가 0. 본 마이그레이션은 ① 관계 master 확장(귀문/암합) ② 효과적 십성 시드/링크만.
-- 관계는 070 자동생성 풀(합충형해파+원진)을 재사용하고 귀문/암합만 추가 — mass-wiring 회피, 검증 연결은
-- 효과적 십성에 집중하고 관계는 evidence 누적 → P5 sql-discovery가 채움(헌장 ②).
--
-- 보안: 원국 디테일 노출 0. 귀문/암합 쌍은 표준 관계표(학파별 상이 가능, 파라미터). auto-gen 설명은
-- 중립 표기(본인 글자 주석 미부착). 큐레이트는 generic 십성→행동 매핑(071 공개 범위)만, 신규 원국 노출 없음.

-- ─── A. relation_type CHECK 확장 (귀문·암합) ──────────────
ALTER TABLE branch_relations
  DROP CONSTRAINT branch_relations_relation_type_check;
ALTER TABLE branch_relations
  ADD CONSTRAINT branch_relations_relation_type_check
  CHECK (relation_type IN ('육합','삼합','방합','충','형','파','해','원진','귀문','암합'));

-- ─── B. trigger_target_type CHECK 확장 (hwa_sipsung) ──────
ALTER TABLE pattern_catalog
  DROP CONSTRAINT pattern_catalog_trigger_target_type_check;
ALTER TABLE pattern_catalog
  ADD CONSTRAINT pattern_catalog_trigger_target_type_check
  CHECK (trigger_target_type IN (
    'stem', 'branch', 'ganji', 'element_density', 'sibiunsung', 'relation',
    'cumulative_pillar_count',
    'strength_band',
    'hwa_sipsung',  -- #477 P4b 신규 (효과적 십성 — 합화 변환 결과)
    'life_signal'
  ));

-- ─── C. 귀문/암합 쌍 → branch_relations ───────────────────
-- 귀문: 표준 귀문관살 6쌍(사술은 원진과 동시 발현 — 사용자 임상 정합, 마이그레이션 055 참조).
-- 암합: 대표 정기-정기 천간합 4쌍(인축=갑기 / 묘신=을경 / 사유=병신 / 오해=정임). 전체 암합 미채택.
-- 단방향 저장(트리거가 members로 양방향 평가). UNIQUE(a,b,rel) 멱등.
INSERT INTO branch_relations (branch_a_id, branch_b_id, relation_type)
SELECT ba.id, bb.id, pair.rel
FROM (VALUES
  ('자','유','귀문'), ('축','오','귀문'), ('인','미','귀문'),
  ('묘','신','귀문'), ('진','해','귀문'), ('사','술','귀문'),
  ('인','축','암합'), ('묘','신','암합'), ('사','유','암합'), ('오','해','암합')
) AS pair(a, b, rel)
JOIN branches_master ba ON ba.name = pair.a
JOIN branches_master bb ON bb.name = pair.b
ON CONFLICT (branch_a_id, branch_b_id, relation_type) DO NOTHING;

-- ─── D. auto-gen 관계 시드 (귀문·암합, 070 LOOP 패턴) ──────
-- 풀셋 형태 trigger_aux={type:'branch_<rel>', members:[a,b]} — 원국에 멤버 있고 일운이 반대 멤버면 발현.
-- 원국에 없는 쌍은 휴면(헌장 ④ 미리 구현). evidence-only(링크 없음) → P5 discovery가 검증 연결.
DO $$
DECLARE rel RECORD;
  name_text TEXT;
  desc_text TEXT;
  aux_json JSONB;
BEGIN
  FOR rel IN
    SELECT br.relation_type, ba.name AS ba_name, bb.name AS bb_name
      FROM branch_relations br
      JOIN branches_master ba ON ba.id = br.branch_a_id
      JOIN branches_master bb ON bb.id = br.branch_b_id
     WHERE br.relation_type IN ('귀문', '암합')
     ORDER BY br.id
  LOOP
    name_text := 'pool_' || rel.relation_type || '_' || rel.ba_name || rel.bb_name;
    desc_text := '지지 ' || rel.relation_type || ' 발현일 — ' || rel.ba_name || '·' || rel.bb_name;
    aux_json := jsonb_build_object(
      'type', 'branch_' || rel.relation_type,
      'members', jsonb_build_array(rel.ba_name, rel.bb_name)
    );
    INSERT INTO pattern_catalog
      (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux,
       pattern_kind, source, active)
    VALUES (1, name_text, NULL, desc_text, 'relation', NULL, aux_json, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
  END LOOP;
END $$;

-- ─── E. 효과적 십성 시드 5개 (hwa_sipsung) ────────────────
-- aux={sipsin:'<5그룹>', via:'hwa'}. 합화 성립일에만 발현(sparse, 정직). pillar_level=NULL(풀셋 계산).
INSERT INTO pattern_catalog
  (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux,
   pillar_level, pattern_kind, source, active)
VALUES
  (1, 'pool_합화십성_비겁', NULL, '합화 변환 결과 효과적 십성 = 비겁(자기·주체·경쟁) 발현일',
   'hwa_sipsung', NULL, '{"sipsin":"비겁","via":"hwa"}'::jsonb, NULL, 'saju', 'seed', true),
  (1, 'pool_합화십성_식상', NULL, '합화 변환 결과 효과적 십성 = 식상(표현·활동·창작) 발현일',
   'hwa_sipsung', NULL, '{"sipsin":"식상","via":"hwa"}'::jsonb, NULL, 'saju', 'seed', true),
  (1, 'pool_합화십성_재성', NULL, '합화 변환 결과 효과적 십성 = 재성(재물·소비·실리) 발현일',
   'hwa_sipsung', NULL, '{"sipsin":"재성","via":"hwa"}'::jsonb, NULL, 'saju', 'seed', true),
  (1, 'pool_합화십성_관성', NULL, '합화 변환 결과 효과적 십성 = 관성(규율·책임·압박) 발현일',
   'hwa_sipsung', NULL, '{"sipsin":"관성","via":"hwa"}'::jsonb, NULL, 'saju', 'seed', true),
  (1, 'pool_합화십성_인성', NULL, '합화 변환 결과 효과적 십성 = 인성(사유·수용·휴식) 발현일',
   'hwa_sipsung', NULL, '{"sipsin":"인성","via":"hwa"}'::jsonb, NULL, 'saju', 'seed', true)
ON CONFLICT (user_id, name) DO NOTHING;

-- ─── F. 큐레이트 링크 10 (효과적 십성 × 객관 신호) ─────────
-- generic 십성→행동 매핑(원국 무관, 071 공개 범위). 모두 양의 연관(발현일 신호 pass율↑) —
-- off-day 엔진은 양의 연관만 confirm하므로 신호 direction과 정합. 신호명별 MIN(id)로 1:1 링크.
INSERT INTO pattern_links (user_id, seed_id, signal_id, source, status)
SELECT 1, c.id, sig.id, 'manual', 'active'
FROM (VALUES
  ('pool_합화십성_재성', 'expense_total'),         -- 재성일 소비↑
  ('pool_합화십성_재성', 'wealth_awareness'),      -- 재물 인식 태그
  ('pool_합화십성_식상', 'talkative'),             -- 표현·말 많아짐
  ('pool_합화십성_식상', 'creating'),              -- 창작·생산 태그
  ('pool_합화십성_인성', 'deep_thought'),          -- 사유 깊어짐
  ('pool_합화십성_인성', 'analytical_mode'),       -- 분석 모드 태그
  ('pool_합화십성_관성', 'task_completion'),       -- 규율·완수 태그
  ('pool_합화십성_관성', 'schedule_completion_rate'), -- 일정 완수율↑
  ('pool_합화십성_비겁', 'physical_activity'),     -- 자기 주도 활동
  ('pool_합화십성_비겁', 'confidence_high')        -- 자아·주체 태그
) AS pair(seed_name, signal_name)
JOIN pattern_catalog c ON c.user_id = 1 AND c.name = pair.seed_name
JOIN LATERAL (
  SELECT id FROM signal_defs
  WHERE user_id = 1 AND name = pair.signal_name AND status = 'active'
  ORDER BY id LIMIT 1
) sig ON true
ON CONFLICT (seed_id, signal_id) DO NOTHING;

-- ─── G. 정합 검증 (RAISE 시 파일 트랜잭션 롤백) ───────────
DO $$
DECLARE
  hwa_seeds INT;
  hwa_links INT;
  gwimun INT;
  amhap INT;
  rel_seeds INT;
BEGIN
  SELECT count(*) INTO hwa_seeds FROM pattern_catalog
   WHERE user_id = 1 AND trigger_target_type = 'hwa_sipsung';
  IF hwa_seeds <> 5 THEN
    RAISE EXCEPTION '[082] hwa_sipsung 시드 수 % (기대 5)', hwa_seeds;
  END IF;

  SELECT count(*) INTO hwa_links FROM pattern_links l
    JOIN pattern_catalog c ON c.id = l.seed_id
   WHERE c.user_id = 1 AND c.trigger_target_type = 'hwa_sipsung';
  IF hwa_links <> 10 THEN
    RAISE EXCEPTION '[082] 효과적 십성 링크 수 % (기대 10 — 신호명 누락 의심)', hwa_links;
  END IF;

  SELECT count(*) INTO gwimun FROM branch_relations WHERE relation_type = '귀문';
  IF gwimun <> 6 THEN
    RAISE EXCEPTION '[082] 귀문 쌍 수 % (기대 6)', gwimun;
  END IF;

  SELECT count(*) INTO amhap FROM branch_relations WHERE relation_type = '암합';
  IF amhap <> 4 THEN
    RAISE EXCEPTION '[082] 암합 쌍 수 % (기대 4)', amhap;
  END IF;

  -- 귀문/암합 auto-gen 관계 시드 — 10 새 쌍 → 최소 10 시드(멱등 ON CONFLICT라 ≥).
  SELECT count(*) INTO rel_seeds FROM pattern_catalog
   WHERE user_id = 1 AND trigger_target_type = 'relation'
     AND (name LIKE 'pool_귀문_%' OR name LIKE 'pool_암합_%');
  IF rel_seeds < 10 THEN
    RAISE EXCEPTION '[082] 귀문/암합 auto-gen 시드 % (기대 ≥10)', rel_seeds;
  END IF;

  RAISE NOTICE '[082] P4b OK — hwa_sipsung 시드 %, 링크 %, 귀문 %, 암합 %, 관계 auto-gen %',
    hwa_seeds, hwa_links, gwimun, amhap, rel_seeds;
END $$;
