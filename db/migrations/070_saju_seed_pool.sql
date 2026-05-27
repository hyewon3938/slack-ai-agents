-- 070: 마스터 #434 Phase 2 — 사주 시드 풀세트 161개 INSERT
-- 자동 생성: scripts/generate-saju-seed-pool.ts
-- 풀셋은 매트릭 없이 등록 (evidence-only). pattern_matches.matched=NULL,
-- verify_status='no_metric'. 60+일 evidence 누적 → Phase 6 LLM 매트릭 제안 슬롯
-- 가설 후보 풀로 활용 (ADR-0027).
--
-- 본인 컨텍스트 (user_id=1): 일간 경금 / 일지 술토 / 본명 갑경경경 자술술술
-- 자수 십신 정정: 자 = 상관 (사용자 임상, 식신 X)

BEGIN;

-- ── 1) STEM 풀셋 (신규 2개: 을 정재, 신 겁재) ──
DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT id INTO t_id FROM stems_master WHERE name='을';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_을_천간', '정재', $desc$을목 천간 발현일 — 정재(안정적 재물 관리, 계획적 소비, 꾸준한 일정 진행)$desc$, 'stem', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT id INTO t_id FROM stems_master WHERE name='신';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_신_천간', '겁재', $desc$신금 천간 발현일 — 겁재(경쟁심·과시·이성 관심)$desc$, 'stem', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

-- ── 2) BRANCH 풀셋 단일 (신규 9개: 자, 축, 인, 묘, 진, 사, 미, 신, 유) ──
DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT id INTO t_id FROM branches_master WHERE name='자';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_자_지지', '상관', $desc$자수 지지 발현일 — 상관(충동적 식사·배달·과식, 다 뒤집어 엎기·전면 개편, 관성 충돌)$desc$, 'branch', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT id INTO t_id FROM branches_master WHERE name='축';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_축_지지', '정인', $desc$축토 지지 발현일 — 정인(차분한 휴식·내면 안정·잔잔한 회복)$desc$, 'branch', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT id INTO t_id FROM branches_master WHERE name='인';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_인_지지', '편재', $desc$인목 지지 발현일 — 편재(새로운 시작·역동, 재물 활성)$desc$, 'branch', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT id INTO t_id FROM branches_master WHERE name='묘';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_묘_지지', '정재', $desc$묘목 지지 발현일 — 정재(꾸준한 노력·계획적 진행)$desc$, 'branch', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT id INTO t_id FROM branches_master WHERE name='진';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_진_지지', '편인', $desc$진토 지지 발현일 — 편인(침묵·내면 침잠·과거 기억, 본인 일지 술 충 동반 가능성)$desc$, 'branch', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT id INTO t_id FROM branches_master WHERE name='사';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_사_지지', '편관', $desc$사화 지지 발현일 — 편관(추진·도전 + 신체 증상: 대상포진·피부 트러블·탈진. 사술원진/오행 쏠림 동반 시 강화 — 분리 검증 필요)$desc$, 'branch', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT id INTO t_id FROM branches_master WHERE name='미';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_미_지지', '정인', $desc$미토 지지 발현일 — 정인(부드러운 휴식·따뜻한 분위기)$desc$, 'branch', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT id INTO t_id FROM branches_master WHERE name='신';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_신_지지', '비견', $desc$신금 지지 발현일 — 비견(자기 동질감·동기 영역, 비견 충돌 가능)$desc$, 'branch', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT id INTO t_id FROM branches_master WHERE name='유';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_유_지지', '겁재', $desc$유금 지지 발현일 — 겁재(경쟁·과시·이성 관심)$desc$, 'branch', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

-- ── 3) GANJI 풀셋 (신규 60개 — 60갑자 콤보) ──
DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '갑' AND b.name = '자';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_갑자', NULL, $desc$갑자 60갑자일 — 갑(편재) + 자(상관) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '을' AND b.name = '축';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_을축', NULL, $desc$을축 60갑자일 — 을(정재) + 축(정인) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '병' AND b.name = '인';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_병인', NULL, $desc$병인 60갑자일 — 병(편관) + 인(편재) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '정' AND b.name = '묘';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_정묘', NULL, $desc$정묘 60갑자일 — 정(정관) + 묘(정재) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '무' AND b.name = '진';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_무진', NULL, $desc$무진 60갑자일 — 무(편인) + 진(편인) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '기' AND b.name = '사';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_기사', NULL, $desc$기사 60갑자일 — 기(정인) + 사(편관) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '경' AND b.name = '오';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_경오', NULL, $desc$경오 60갑자일 — 경(비견) + 오(정관) 콤보 — 본인 일간 비화$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '신' AND b.name = '미';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_신미', NULL, $desc$신미 60갑자일 — 신(겁재) + 미(정인) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '임' AND b.name = '신';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_임신', NULL, $desc$임신 60갑자일 — 임(식신) + 신(비견) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '계' AND b.name = '유';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_계유', NULL, $desc$계유 60갑자일 — 계(상관) + 유(겁재) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '갑' AND b.name = '술';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_갑술', NULL, $desc$갑술 60갑자일 — 갑(편재) + 술(편인) 콤보 — 본인 일지 비화$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '을' AND b.name = '해';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_을해', NULL, $desc$을해 60갑자일 — 을(정재) + 해(식신) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '병' AND b.name = '자';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_병자', NULL, $desc$병자 60갑자일 — 병(편관) + 자(상관) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '정' AND b.name = '축';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_정축', NULL, $desc$정축 60갑자일 — 정(정관) + 축(정인) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '무' AND b.name = '인';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_무인', NULL, $desc$무인 60갑자일 — 무(편인) + 인(편재) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '기' AND b.name = '묘';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_기묘', NULL, $desc$기묘 60갑자일 — 기(정인) + 묘(정재) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '경' AND b.name = '진';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_경진', NULL, $desc$경진 60갑자일 — 경(비견) + 진(편인) 콤보 — 본인 일간 비화$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '신' AND b.name = '사';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_신사', NULL, $desc$신사 60갑자일 — 신(겁재) + 사(편관) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '임' AND b.name = '오';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_임오', NULL, $desc$임오 60갑자일 — 임(식신) + 오(정관) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '계' AND b.name = '미';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_계미', NULL, $desc$계미 60갑자일 — 계(상관) + 미(정인) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '갑' AND b.name = '신';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_갑신', NULL, $desc$갑신 60갑자일 — 갑(편재) + 신(비견) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '을' AND b.name = '유';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_을유', NULL, $desc$을유 60갑자일 — 을(정재) + 유(겁재) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '병' AND b.name = '술';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_병술', NULL, $desc$병술 60갑자일 — 병(편관) + 술(편인) 콤보 — 본인 일지 비화$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '정' AND b.name = '해';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_정해', NULL, $desc$정해 60갑자일 — 정(정관) + 해(식신) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '무' AND b.name = '자';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_무자', NULL, $desc$무자 60갑자일 — 무(편인) + 자(상관) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '기' AND b.name = '축';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_기축', NULL, $desc$기축 60갑자일 — 기(정인) + 축(정인) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '경' AND b.name = '인';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_경인', NULL, $desc$경인 60갑자일 — 경(비견) + 인(편재) 콤보 — 본인 일간 비화$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '신' AND b.name = '묘';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_신묘', NULL, $desc$신묘 60갑자일 — 신(겁재) + 묘(정재) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '임' AND b.name = '진';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_임진', NULL, $desc$임진 60갑자일 — 임(식신) + 진(편인) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '계' AND b.name = '사';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_계사', NULL, $desc$계사 60갑자일 — 계(상관) + 사(편관) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '갑' AND b.name = '오';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_갑오', NULL, $desc$갑오 60갑자일 — 갑(편재) + 오(정관) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '을' AND b.name = '미';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_을미', NULL, $desc$을미 60갑자일 — 을(정재) + 미(정인) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '병' AND b.name = '신';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_병신', NULL, $desc$병신 60갑자일 — 병(편관) + 신(비견) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '정' AND b.name = '유';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_정유', NULL, $desc$정유 60갑자일 — 정(정관) + 유(겁재) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '무' AND b.name = '술';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_무술', NULL, $desc$무술 60갑자일 — 무(편인) + 술(편인) 콤보 — 본인 일지 비화$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '기' AND b.name = '해';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_기해', NULL, $desc$기해 60갑자일 — 기(정인) + 해(식신) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '경' AND b.name = '자';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_경자', NULL, $desc$경자 60갑자일 — 경(비견) + 자(상관) 콤보 — 본인 일간 비화$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '신' AND b.name = '축';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_신축', NULL, $desc$신축 60갑자일 — 신(겁재) + 축(정인) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '임' AND b.name = '인';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_임인', NULL, $desc$임인 60갑자일 — 임(식신) + 인(편재) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '계' AND b.name = '묘';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_계묘', NULL, $desc$계묘 60갑자일 — 계(상관) + 묘(정재) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '갑' AND b.name = '진';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_갑진', NULL, $desc$갑진 60갑자일 — 갑(편재) + 진(편인) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '을' AND b.name = '사';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_을사', NULL, $desc$을사 60갑자일 — 을(정재) + 사(편관) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '병' AND b.name = '오';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_병오', NULL, $desc$병오 60갑자일 — 병(편관) + 오(정관) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '정' AND b.name = '미';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_정미', NULL, $desc$정미 60갑자일 — 정(정관) + 미(정인) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '무' AND b.name = '신';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_무신', NULL, $desc$무신 60갑자일 — 무(편인) + 신(비견) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '기' AND b.name = '유';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_기유', NULL, $desc$기유 60갑자일 — 기(정인) + 유(겁재) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '경' AND b.name = '술';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_경술', NULL, $desc$경술 60갑자일 — 경(비견) + 술(편인) 콤보 — 본인 일주와 동일$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '신' AND b.name = '해';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_신해', NULL, $desc$신해 60갑자일 — 신(겁재) + 해(식신) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '임' AND b.name = '자';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_임자', NULL, $desc$임자 60갑자일 — 임(식신) + 자(상관) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '계' AND b.name = '축';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_계축', NULL, $desc$계축 60갑자일 — 계(상관) + 축(정인) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '갑' AND b.name = '인';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_갑인', NULL, $desc$갑인 60갑자일 — 갑(편재) + 인(편재) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '을' AND b.name = '묘';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_을묘', NULL, $desc$을묘 60갑자일 — 을(정재) + 묘(정재) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '병' AND b.name = '진';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_병진', NULL, $desc$병진 60갑자일 — 병(편관) + 진(편인) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '정' AND b.name = '사';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_정사', NULL, $desc$정사 60갑자일 — 정(정관) + 사(편관) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '무' AND b.name = '오';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_무오', NULL, $desc$무오 60갑자일 — 무(편인) + 오(정관) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '기' AND b.name = '미';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_기미', NULL, $desc$기미 60갑자일 — 기(정인) + 미(정인) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '경' AND b.name = '신';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_경신', NULL, $desc$경신 60갑자일 — 경(비견) + 신(비견) 콤보 — 본인 일간 비화$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '신' AND b.name = '유';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_신유', NULL, $desc$신유 60갑자일 — 신(겁재) + 유(겁재) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '임' AND b.name = '술';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_임술', NULL, $desc$임술 60갑자일 — 임(식신) + 술(편인) 콤보 — 본인 일지 비화$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

DO $$
DECLARE t_id INTEGER;
BEGIN
  SELECT g.id INTO t_id
    FROM ganji_master g
    JOIN stems_master s ON s.id = g.stem_id
    JOIN branches_master b ON b.id = g.branch_id
    WHERE s.name = '계' AND b.name = '해';
  INSERT INTO pattern_catalog
    (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, 'pool_계해', NULL, $desc$계해 60갑자일 — 계(상관) + 해(식신) 콤보$desc$, 'ganji', t_id, NULL, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
END $$;

-- ── 4) ELEMENT_DENSITY 풀셋 (신규 9개 — 토_과다는 S5 보존) ──
INSERT INTO pattern_catalog
  (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
  VALUES (1, 'pool_목_과다', NULL, $desc$목 오행 과다일 (10자 중 3+) — 재다신약(편재·정재 폭주, 일간 약화)$desc$, 'element_density', NULL, '{"element":"목","min_count":3}'::jsonb, 'saju', 'seed', true)
  ON CONFLICT (user_id, name) DO NOTHING;

INSERT INTO pattern_catalog
  (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
  VALUES (1, 'pool_화_과다', NULL, $desc$화 오행 과다일 (10자 중 3+) — 화극금(본인 일간 경금 피해, 신체적 피로·발열·피부 트러블)$desc$, 'element_density', NULL, '{"element":"화","min_count":3}'::jsonb, 'saju', 'seed', true)
  ON CONFLICT (user_id, name) DO NOTHING;

INSERT INTO pattern_catalog
  (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
  VALUES (1, 'pool_금_과다', NULL, $desc$금 오행 과다일 (10자 중 3+) — 비견·겁재 폭주, 자기주장·고집$desc$, 'element_density', NULL, '{"element":"금","min_count":3}'::jsonb, 'saju', 'seed', true)
  ON CONFLICT (user_id, name) DO NOTHING;

INSERT INTO pattern_catalog
  (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
  VALUES (1, 'pool_수_과다', NULL, $desc$수 오행 과다일 (10자 중 3+) — 식상 폭주, 식사·창작·말 많음$desc$, 'element_density', NULL, '{"element":"수","min_count":3}'::jsonb, 'saju', 'seed', true)
  ON CONFLICT (user_id, name) DO NOTHING;

INSERT INTO pattern_catalog
  (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
  VALUES (1, 'pool_목_부재', NULL, $desc$목 오행 부재일 (10자 중 0) — 편재·정재 결핍, 동력 부족$desc$, 'element_density', NULL, '{"element":"목","max_count":0}'::jsonb, 'saju', 'seed', true)
  ON CONFLICT (user_id, name) DO NOTHING;

INSERT INTO pattern_catalog
  (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
  VALUES (1, 'pool_화_부재', NULL, $desc$화 오행 부재일 (10자 중 0) — 관성 결핍, 책임 회피 경향$desc$, 'element_density', NULL, '{"element":"화","max_count":0}'::jsonb, 'saju', 'seed', true)
  ON CONFLICT (user_id, name) DO NOTHING;

INSERT INTO pattern_catalog
  (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
  VALUES (1, 'pool_토_부재', NULL, $desc$토 오행 부재일 (10자 중 0) — 인성 결핍, 의지처 부족$desc$, 'element_density', NULL, '{"element":"토","max_count":0}'::jsonb, 'saju', 'seed', true)
  ON CONFLICT (user_id, name) DO NOTHING;

INSERT INTO pattern_catalog
  (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
  VALUES (1, 'pool_금_부재', NULL, $desc$금 오행 부재일 (10자 중 0) — 일간 동기 결핍, 자신감 저하$desc$, 'element_density', NULL, '{"element":"금","max_count":0}'::jsonb, 'saju', 'seed', true)
  ON CONFLICT (user_id, name) DO NOTHING;

INSERT INTO pattern_catalog
  (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
  VALUES (1, 'pool_수_부재', NULL, $desc$수 오행 부재일 (10자 중 0) — 식상 결핍, 표현·먹기 저하$desc$, 'element_density', NULL, '{"element":"수","max_count":0}'::jsonb, 'saju', 'seed', true)
  ON CONFLICT (user_id, name) DO NOTHING;

-- ── 5) SIBIUNSUNG 풀셋 (신규 11개 — S6 사·묘 통합에 포함된 묘 제외) ──
INSERT INTO pattern_catalog
  (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
  VALUES (1, 'pool_장생', NULL, $desc$장생일 — 새로운 시작·기획·신선한 에너지$desc$, 'sibiunsung', NULL, '{"states":["장생"]}'::jsonb, 'saju', 'seed', true)
  ON CONFLICT (user_id, name) DO NOTHING;

INSERT INTO pattern_catalog
  (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
  VALUES (1, 'pool_목욕', NULL, $desc$목욕일 — 변화·정리·기분 전환$desc$, 'sibiunsung', NULL, '{"states":["목욕"]}'::jsonb, 'saju', 'seed', true)
  ON CONFLICT (user_id, name) DO NOTHING;

INSERT INTO pattern_catalog
  (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
  VALUES (1, 'pool_관대', NULL, $desc$관대일 — 성숙·책임감 강화$desc$, 'sibiunsung', NULL, '{"states":["관대"]}'::jsonb, 'saju', 'seed', true)
  ON CONFLICT (user_id, name) DO NOTHING;

INSERT INTO pattern_catalog
  (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
  VALUES (1, 'pool_건록', NULL, $desc$건록일 — 활력·열정·업무 폭주·운동 잘됨$desc$, 'sibiunsung', NULL, '{"states":["건록"]}'::jsonb, 'saju', 'seed', true)
  ON CONFLICT (user_id, name) DO NOTHING;

INSERT INTO pattern_catalog
  (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
  VALUES (1, 'pool_제왕', NULL, $desc$제왕일 — 최고 활력·자기 주장 강화$desc$, 'sibiunsung', NULL, '{"states":["제왕"]}'::jsonb, 'saju', 'seed', true)
  ON CONFLICT (user_id, name) DO NOTHING;

INSERT INTO pattern_catalog
  (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
  VALUES (1, 'pool_쇠', NULL, $desc$쇠일 — 활력 저하·정리 단계$desc$, 'sibiunsung', NULL, '{"states":["쇠"]}'::jsonb, 'saju', 'seed', true)
  ON CONFLICT (user_id, name) DO NOTHING;

INSERT INTO pattern_catalog
  (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
  VALUES (1, 'pool_병', NULL, $desc$병일 — 컨디션 저하·신체 증상 주의$desc$, 'sibiunsung', NULL, '{"states":["병"]}'::jsonb, 'saju', 'seed', true)
  ON CONFLICT (user_id, name) DO NOTHING;

INSERT INTO pattern_catalog
  (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
  VALUES (1, 'pool_사', NULL, $desc$사일 — 단절 + 체력 저하·몸 무거움·지침$desc$, 'sibiunsung', NULL, '{"states":["사"]}'::jsonb, 'saju', 'seed', true)
  ON CONFLICT (user_id, name) DO NOTHING;

INSERT INTO pattern_catalog
  (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
  VALUES (1, 'pool_절', NULL, $desc$절일 — 단절·새 출발 직전 침잠$desc$, 'sibiunsung', NULL, '{"states":["절"]}'::jsonb, 'saju', 'seed', true)
  ON CONFLICT (user_id, name) DO NOTHING;

INSERT INTO pattern_catalog
  (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
  VALUES (1, 'pool_태', NULL, $desc$태일 — 잠재·내부 성장 단계$desc$, 'sibiunsung', NULL, '{"states":["태"]}'::jsonb, 'saju', 'seed', true)
  ON CONFLICT (user_id, name) DO NOTHING;

INSERT INTO pattern_catalog
  (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
  VALUES (1, 'pool_양', NULL, $desc$양일 — 부드러운 회복·따뜻함$desc$, 'sibiunsung', NULL, '{"states":["양"]}'::jsonb, 'saju', 'seed', true)
  ON CONFLICT (user_id, name) DO NOTHING;

-- ── 6) RELATION 풀셋 (신규 70개) ──
-- 지지 관계 (61개) — branch_relations LOOP, 기존 N3(진술충)/S2(사술원진) 제외
DO $$
DECLARE rel RECORD;
  desc_text TEXT;
  aux_json JSONB;
  name_text TEXT;
  ba_sipsin TEXT;
  bb_sipsin TEXT;
  natal_member TEXT;
  is_existing BOOLEAN;
BEGIN
  FOR rel IN
    SELECT br.relation_type, ba.name AS ba_name, bb.name AS bb_name
      FROM branch_relations br
      JOIN branches_master ba ON ba.id = br.branch_a_id
      JOIN branches_master bb ON bb.id = br.branch_b_id
      ORDER BY br.id
  LOOP
    -- 기존 시드 제외 (진-술 충, 사-술 원진)
    is_existing := (rel.ba_name = '진' AND rel.bb_name = '술' AND rel.relation_type = '충')
                OR (rel.ba_name = '술' AND rel.bb_name = '진' AND rel.relation_type = '충')
                OR (rel.ba_name = '사' AND rel.bb_name = '술' AND rel.relation_type = '원진')
                OR (rel.ba_name = '술' AND rel.bb_name = '사' AND rel.relation_type = '원진');
    IF is_existing THEN
      CONTINUE;
    END IF;

    name_text := 'pool_' || rel.relation_type || '_' || rel.ba_name || rel.bb_name;
    desc_text := '지지 ' || rel.relation_type || ' 발현일 — ' || rel.ba_name || '·' || rel.bb_name;

    -- 본인 일지(술) 또는 본명 지지(자/술)와 관련된 관계는 추가 단서
    IF rel.ba_name = '술' OR rel.bb_name = '술' THEN
      desc_text := desc_text || ' (본인 일지 ' || rel.relation_type || ', 자기 영역 흔들림)';
    ELSIF rel.ba_name = '자' OR rel.bb_name = '자' THEN
      desc_text := desc_text || ' (본인 본명 자 ' || rel.relation_type || ')';
    END IF;

    aux_json := jsonb_build_object(
      'type', 'branch_' || rel.relation_type,
      'members', jsonb_build_array(rel.ba_name, rel.bb_name)
    );

    INSERT INTO pattern_catalog
      (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, name_text, NULL, desc_text, 'relation', NULL, aux_json, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
  END LOOP;
END $$;

-- 천간 관계 (11개) — stem_relations LOOP
DO $$
DECLARE rel RECORD;
  desc_text TEXT;
  aux_json JSONB;
  name_text TEXT;
BEGIN
  FOR rel IN
    SELECT sr.relation_type, sa.name AS sa_name, sb.name AS sb_name
      FROM stem_relations sr
      JOIN stems_master sa ON sa.id = sr.stem_a_id
      JOIN stems_master sb ON sb.id = sr.stem_b_id
      ORDER BY sr.id
  LOOP
    name_text := 'pool_' || rel.relation_type || '_' || rel.sa_name || rel.sb_name;
    desc_text := '천간 ' || rel.relation_type || ' 발현일 — ' || rel.sa_name || '·' || rel.sb_name;

    -- 본인 본명 천간(갑/경)과 관련된 관계는 추가 단서
    IF rel.sa_name = '경' OR rel.sb_name = '경' THEN
      desc_text := desc_text || ' (본인 일간 ' || rel.relation_type || ')';
    ELSIF rel.sa_name = '갑' OR rel.sb_name = '갑' THEN
      desc_text := desc_text || ' (본인 본명 갑 ' || rel.relation_type || ')';
    END IF;

    aux_json := jsonb_build_object(
      'type', 'stem_' || rel.relation_type,
      'members', jsonb_build_array(rel.sa_name, rel.sb_name)
    );

    INSERT INTO pattern_catalog
      (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux, pattern_kind, source, active)
    VALUES (1, name_text, NULL, desc_text, 'relation', NULL, aux_json, 'saju', 'seed', true)
    ON CONFLICT (user_id, name) DO NOTHING;
  END LOOP;
END $$;

COMMIT;

