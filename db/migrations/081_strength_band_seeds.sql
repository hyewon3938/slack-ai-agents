-- 081: 결정론 사주 강도 feature 엔진 — strength_band 시드 + 분위수 컷 저장 (#477 P4a, ADR-0036·0037)
-- A. trigger_target_type CHECK에 'strength_band' 추가.
-- B. strength_band_cutpoints — target별 주간 분위수 컷(일별 cron의 "오늘 밴드" 판정용).
-- C. 18 강도 시드 — 일간 + 5오행 각 약/적정/강 밴드(trigger_aux={target,band}). 전부 즉시 활성 로그 누적.
-- D. 큐레이트 스타터 링크 13 — 강도 밴드 × 객관 신호(off-day 검증 시작). 옵션 B: 일간 행동 +
--    오행 절대 테마(화→건강, 071 선례) + 재성(목→지출, 071 편재=목 공개 매핑) 앵커. 모두 양의 연관.
--    나머지 오행 밴드(토·금·수, 목/화 약·적정)는 링크 없이 활성만 누적 → P5 sql-discovery가 채움.
-- E. 정합 검증 (RAISE 시 파일 트랜잭션 롤백). 신호명 누락 시 링크 수 미달 → RAISE.
--
-- 강도는 검정에서 상대 분위수 밴드(내 안 약/적정/강)로만 의미. 절대 신강/신약는 TS가 병행 계산(맥락·미래).

-- ─── A. trigger_target_type CHECK 확장 ───────────────────
ALTER TABLE pattern_catalog
  DROP CONSTRAINT pattern_catalog_trigger_target_type_check;
ALTER TABLE pattern_catalog
  ADD CONSTRAINT pattern_catalog_trigger_target_type_check
  CHECK (trigger_target_type IN (
    'stem', 'branch', 'ganji', 'element_density', 'sibiunsung', 'relation',
    'cumulative_pillar_count',
    'strength_band',  -- #477 P4a 신규 (강도 밴드)
    'life_signal'
  ));

-- ─── B. 분위수 컷 저장 (target당 1행, 주간 갱신 → 일별 적용) ──
CREATE TABLE strength_band_cutpoints (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target      TEXT NOT NULL,        -- 'day_master' | '목'|'화'|'토'|'금'|'수'
  low_cut     NUMERIC NOT NULL,     -- value < low_cut → 'low' 밴드
  high_cut    NUMERIC NOT NULL,     -- value ≥ high_cut → 'high' 밴드
  n_samples   INTEGER NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, target)
);

COMMENT ON TABLE strength_band_cutpoints IS
  '강도 밴드 분위수 컷 (#477 P4a). 주간 검증 엔진이 윈도우 강도 시리즈로 tertile 산출·UPSERT → 일별 매칭 cron이 "오늘 강도"를 이 컷에 비교해 밴드 판정(seed_daily_activations·recent tier). 주간 엔진 자체 검증은 윈도우 재계산이라 이 값에 의존 안 함(일별 경로 전용). UNIQUE(user_id,target) 멱등.';

-- ─── C. 18 강도 시드 (일간 + 5오행 × 약/적정/강) ──────────
-- trigger_aux.target ∈ {day_master,목,화,토,금,수}, band ∈ {low,mid,high}. pillar_level=NULL(풀셋 계산).
INSERT INTO pattern_catalog
  (user_id, name, sipsin, description, trigger_target_type, trigger_target_id, trigger_aux,
   pillar_level, pattern_kind, source, active)
VALUES
  (1, 'pool_강도_일간_약', NULL, '일간 실효 강도 약(신약 경향) — 생조 약한 날, 기운·실행력 저하 가설',
   'strength_band', NULL, '{"target":"day_master","band":"low"}'::jsonb, NULL, 'saju', 'seed', true),
  (1, 'pool_강도_일간_적정', NULL, '일간 실효 강도 적정(중화 경향) — 균형 구간',
   'strength_band', NULL, '{"target":"day_master","band":"mid"}'::jsonb, NULL, 'saju', 'seed', true),
  (1, 'pool_강도_일간_강', NULL, '일간 실효 강도 강(신강 경향) — 생조 강한 날, 추진력·활동 가설',
   'strength_band', NULL, '{"target":"day_master","band":"high"}'::jsonb, NULL, 'saju', 'seed', true),
  (1, 'pool_강도_목_약', NULL, '목 오행 실효 강도 약 밴드 (상대 분위수)',
   'strength_band', NULL, '{"target":"목","band":"low"}'::jsonb, NULL, 'saju', 'seed', true),
  (1, 'pool_강도_목_적정', NULL, '목 오행 실효 강도 적정 밴드',
   'strength_band', NULL, '{"target":"목","band":"mid"}'::jsonb, NULL, 'saju', 'seed', true),
  (1, 'pool_강도_목_강', NULL, '목 오행 실효 강도 강 밴드 — 재성(목) 발현 강한 날 가설',
   'strength_band', NULL, '{"target":"목","band":"high"}'::jsonb, NULL, 'saju', 'seed', true),
  (1, 'pool_강도_화_약', NULL, '화 오행 실효 강도 약 밴드',
   'strength_band', NULL, '{"target":"화","band":"low"}'::jsonb, NULL, 'saju', 'seed', true),
  (1, 'pool_강도_화_적정', NULL, '화 오행 실효 강도 적정 밴드',
   'strength_band', NULL, '{"target":"화","band":"mid"}'::jsonb, NULL, 'saju', 'seed', true),
  (1, 'pool_강도_화_강', NULL, '화 오행 실효 강도 강 밴드 — 화극금 건강 부담 가설(071 선례)',
   'strength_band', NULL, '{"target":"화","band":"high"}'::jsonb, NULL, 'saju', 'seed', true),
  (1, 'pool_강도_토_약', NULL, '토 오행 실효 강도 약 밴드',
   'strength_band', NULL, '{"target":"토","band":"low"}'::jsonb, NULL, 'saju', 'seed', true),
  (1, 'pool_강도_토_적정', NULL, '토 오행 실효 강도 적정 밴드',
   'strength_band', NULL, '{"target":"토","band":"mid"}'::jsonb, NULL, 'saju', 'seed', true),
  (1, 'pool_강도_토_강', NULL, '토 오행 실효 강도 강 밴드',
   'strength_band', NULL, '{"target":"토","band":"high"}'::jsonb, NULL, 'saju', 'seed', true),
  (1, 'pool_강도_금_약', NULL, '금 오행 실효 강도 약 밴드',
   'strength_band', NULL, '{"target":"금","band":"low"}'::jsonb, NULL, 'saju', 'seed', true),
  (1, 'pool_강도_금_적정', NULL, '금 오행 실효 강도 적정 밴드',
   'strength_band', NULL, '{"target":"금","band":"mid"}'::jsonb, NULL, 'saju', 'seed', true),
  (1, 'pool_강도_금_강', NULL, '금 오행 실효 강도 강 밴드',
   'strength_band', NULL, '{"target":"금","band":"high"}'::jsonb, NULL, 'saju', 'seed', true),
  (1, 'pool_강도_수_약', NULL, '수 오행 실효 강도 약 밴드',
   'strength_band', NULL, '{"target":"수","band":"low"}'::jsonb, NULL, 'saju', 'seed', true),
  (1, 'pool_강도_수_적정', NULL, '수 오행 실효 강도 적정 밴드',
   'strength_band', NULL, '{"target":"수","band":"mid"}'::jsonb, NULL, 'saju', 'seed', true),
  (1, 'pool_강도_수_강', NULL, '수 오행 실효 강도 강 밴드',
   'strength_band', NULL, '{"target":"수","band":"high"}'::jsonb, NULL, 'saju', 'seed', true)
ON CONFLICT (user_id, name) DO NOTHING;

-- ─── D. 큐레이트 스타터 링크 13 (강도 밴드 × 객관 신호) ────
-- (seed_name, signal_name) 페어 → 신호명별 MIN(id)로 1:1 링크(P1 sql 신호 중복 존재 → 첫 신호 선택).
-- 모두 양의 연관(발현일 신호 pass율↑) — off-day 엔진은 양의 연관만 confirm하므로 신호 direction과 정합.
INSERT INTO pattern_links (user_id, seed_id, signal_id, source, status)
SELECT 1, c.id, sig.id, 'manual', 'active'
FROM (VALUES
  -- 일간 약(신약): 기운 약한 날 행동
  ('pool_강도_일간_약', 'routine_completion_rate'),  -- below_avg → 루틴 처짐
  ('pool_강도_일간_약', 'sleep_nap_count'),           -- 낮잠 증가
  ('pool_강도_일간_약', 'low_energy'),                -- 무기력 태그
  ('pool_강도_일간_약', 'health_complaint'),          -- 건강 불편 태그
  -- 일간 강(신강): 추진력
  ('pool_강도_일간_강', 'schedule_completion_rate'),  -- 일정 완료율↑
  ('pool_강도_일간_강', 'schedule_done'),             -- 완료 건수↑
  ('pool_강도_일간_강', 'confidence_high'),           -- 자신감 태그
  ('pool_강도_일간_강', 'task_completion'),           -- 완수 태그
  -- 화 강: 화극금 건강 (071 선례)
  ('pool_강도_화_강', 'health_complaint'),
  ('pool_강도_화_강', 'expense_의료건강'),
  ('pool_강도_화_강', 'irritation'),                  -- 화 = 열·짜증
  -- 목 강: 재성(목) 발현일 소비 (071 편재=목 공개 매핑)
  ('pool_강도_목_강', 'expense_total'),
  ('pool_강도_목_강', 'wealth_awareness')
) AS pair(seed_name, signal_name)
JOIN pattern_catalog c ON c.user_id = 1 AND c.name = pair.seed_name
JOIN LATERAL (
  SELECT id FROM signal_defs
  WHERE user_id = 1 AND name = pair.signal_name AND status = 'active'
  ORDER BY id LIMIT 1
) sig ON true
ON CONFLICT (seed_id, signal_id) DO NOTHING;

-- ─── E. 정합 검증 (RAISE 시 파일 트랜잭션 롤백) ───────────
DO $$
DECLARE
  seed_count INT;
  link_count INT;
  has_table INT;
BEGIN
  SELECT count(*) INTO seed_count FROM pattern_catalog
   WHERE user_id = 1 AND trigger_target_type = 'strength_band';
  IF seed_count <> 18 THEN
    RAISE EXCEPTION '[081] 강도 시드 수 % (기대 18)', seed_count;
  END IF;

  SELECT count(*) INTO has_table FROM information_schema.tables
   WHERE table_name = 'strength_band_cutpoints';
  IF has_table <> 1 THEN
    RAISE EXCEPTION '[081] strength_band_cutpoints 테이블 생성 실패';
  END IF;

  -- 큐레이트 링크 — 신호명 누락 시 13 미만 → RAISE(silent fail 방지).
  SELECT count(*) INTO link_count FROM pattern_links l
    JOIN pattern_catalog c ON c.id = l.seed_id
   WHERE c.user_id = 1 AND c.trigger_target_type = 'strength_band';
  IF link_count <> 13 THEN
    RAISE EXCEPTION '[081] 큐레이트 강도 링크 수 % (기대 13 — 신호명 누락 의심)', link_count;
  END IF;

  RAISE NOTICE '[081] 강도 엔진 시드 OK — 시드 %, 링크 %, 컷 테이블 생성', seed_count, link_count;
END $$;
