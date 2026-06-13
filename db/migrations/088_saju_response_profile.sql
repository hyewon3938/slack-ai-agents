-- 088: 개인화 가중치 집계 레이어 — saju_response_profile (#523 Phase 1, #408 5-B 구체화, ADR-0049)
-- 검증된(confirmed)·검증중(active) pattern_links를 사주 축으로 집계한 파생 셀 프로필.
-- Phase 2(기간 해석)·Phase 3(예측 장부)가 이 프로필을 기간 pillar에 조인한다.
--
-- 이중계산 구조적 차단(D4): 원천 기여 = 링크당 정확히 1 source 셀(stem→천간글자, branch→지지글자,
-- hwa_sipsung→그룹, strength_band 강→오행밴드). 글자 source는 결정론 롤업 → 십성 → 십성그룹(α/β·nActive 합산).
-- 어떤 조회도 두 레벨을 합산하지 않음(단일 레벨 resolution). 천간/지지 글자는 별도 축(char_stem/char_branch) —
-- 한글 동음이의(천간 辛 vs 지지 申='신')가 다른 십성으로 가므로 병합 금지. 오행은 그룹 셀의 별칭(일간 고정 시
-- 동형) → 별도 레벨 저장 안 함. element_band(강 밴드만)는 별도 축.
--
-- 파생 테이블 — 진실 아님(원천 = pattern_links). 주간 검증 엔진이 user당 full-replace(원자적 CTE).

CREATE TABLE saju_response_profile (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  axis_level      TEXT NOT NULL,    -- 'char_stem'(천간글자) | 'char_branch'(지지글자) | 'sipsung'(십성) | 'group'(십성그룹) | 'element_band'(오행 강밴드)
  axis_key        TEXT NOT NULL,    -- 갑(천간)/자(지지) | 비견(십성) | 비겁(그룹) | 목(오행)
  element         TEXT,             -- char/group/element_band → 오행 별칭; sipsung → NULL
  domain          TEXT NOT NULL,    -- 신호 도메인(schedule/routine/sleep/expense/diary_meta) — 셀 분할 축
  tier            TEXT NOT NULL,    -- 'verified'(confirmed 링크 포함) | 'emerging'(효과·발현일 게이트 충족)
  alpha           NUMERIC NOT NULL, -- Σ posterior_alpha (롤업 합산)
  beta            NUMERIC NOT NULL, -- Σ posterior_beta
  shrunk_effect   NUMERIC,          -- shrunk(posterior_p/rate_off, attenuated는 min)의 nActive 가중평균 — winner's curse 차단(D3). NULL=유한 효과 없음
  n_links         INTEGER NOT NULL, -- 이 셀에 기여한 링크 수
  n_active_days   INTEGER NOT NULL, -- Σ nActive (발현일 합)
  stability       BOOLEAN,          -- 전·후반 효과 부호 일치(표시용, 게이트 아님). NULL=판정 불가
  source_link_ids JSONB NOT NULL,   -- provenance — 기여 링크 id 배열
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (axis_level IN ('char_stem', 'char_branch', 'sipsung', 'group', 'element_band')),
  CHECK (tier IN ('verified', 'emerging')),
  UNIQUE (user_id, axis_level, axis_key, domain)
);

COMMENT ON TABLE saju_response_profile IS
  '파생 — pattern_links에서 재생성 가능(진실 아님). 주간 검증 엔진이 confirmed+active 링크를 글자(천간/지지 분리)→십성→그룹(+오행 별칭) 단일레벨 계층 + element_band(강 밴드)로 집계해 user당 full-replace. 이중계산 구조적 차단(D4): 링크당 1 source 셀 + 결정론 롤업, 조회는 단일 레벨(비합산). 효과는 shrunk(D3). #523 Phase 1, ADR-0049.';

-- UNIQUE(user_id, axis_level, axis_key, domain) btree가 resolveCell 조회(user+level+key+domain) 커버 →
-- 별도 인덱스 불요(셀 수십 행 규모).

DO $$
DECLARE
  has_table INT;
BEGIN
  SELECT count(*) INTO has_table FROM information_schema.tables
   WHERE table_name = 'saju_response_profile';
  IF has_table <> 1 THEN
    RAISE EXCEPTION '[088] saju_response_profile 테이블 생성 실패';
  END IF;
  RAISE NOTICE '[088] saju_response_profile 파생 테이블 생성 OK (집계는 주간 엔진이 full-replace)';
END $$;
