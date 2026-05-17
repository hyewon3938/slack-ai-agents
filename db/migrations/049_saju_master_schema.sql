-- 049: 사주 60갑자 마스터 정규화 스키마
-- ADR-0017 참조: docs/adr/0017-saju-ganji-master-normalization.md
-- 정적 데이터(천간 10, 지지 12, 60갑자, 십성/십이운성 lookup, 관계)를 마스터 테이블로 보존.
-- 마스터는 사주 전통 표 기반 — 추가/수정 시 정합성 영향 큼 (FK ON DELETE RESTRICT 적용).

-- 천간 (10행)
CREATE TABLE IF NOT EXISTS stems_master (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,            -- 갑/을/.../계
  element TEXT NOT NULL                  -- 목/화/토/금/수
    CHECK (element IN ('목','화','토','금','수')),
  yinyang TEXT NOT NULL                  -- 양/음
    CHECK (yinyang IN ('양','음'))
);

-- 지지 (12행)
CREATE TABLE IF NOT EXISTS branches_master (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,            -- 자/축/.../해
  element TEXT NOT NULL
    CHECK (element IN ('목','화','토','금','수')),
  yinyang TEXT NOT NULL
    CHECK (yinyang IN ('양','음'))
);

-- 60갑자 (60행)
CREATE TABLE IF NOT EXISTS ganji_master (
  id SERIAL PRIMARY KEY,
  stem_id INTEGER NOT NULL REFERENCES stems_master(id) ON DELETE RESTRICT,
  branch_id INTEGER NOT NULL REFERENCES branches_master(id) ON DELETE RESTRICT,
  UNIQUE (stem_id, branch_id)
);

-- 일간 기준 십성 lookup (10 일간 × 22 타겟 = 220행)
CREATE TABLE IF NOT EXISTS sipsin_lookup (
  id SERIAL PRIMARY KEY,
  day_master_stem_id INTEGER NOT NULL REFERENCES stems_master(id) ON DELETE RESTRICT,
  target_id INTEGER NOT NULL,                 -- stems_master.id 또는 branches_master.id (target_type별 분기)
  target_type TEXT NOT NULL
    CHECK (target_type IN ('stem','branch')),
  sipsin TEXT NOT NULL
    CHECK (sipsin IN ('비견','겁재','식신','상관','편재','정재','편관','정관','편인','정인')),
  UNIQUE (day_master_stem_id, target_id, target_type)
);

-- 일간 기준 12운성 lookup (10 일간 × 12 지지 = 120행)
CREATE TABLE IF NOT EXISTS sibiunsung_lookup (
  id SERIAL PRIMARY KEY,
  day_master_stem_id INTEGER NOT NULL REFERENCES stems_master(id) ON DELETE RESTRICT,
  branch_id INTEGER NOT NULL REFERENCES branches_master(id) ON DELETE RESTRICT,
  state TEXT NOT NULL
    CHECK (state IN ('장생','목욕','관대','건록','제왕','쇠','병','사','묘','절','태','양')),
  UNIQUE (day_master_stem_id, branch_id)
);

-- 지지 관계 (육합/삼합/방합/충/형/파/해/원진) — 단방향 저장, 쿼리 시 (a OR b)
CREATE TABLE IF NOT EXISTS branch_relations (
  id SERIAL PRIMARY KEY,
  branch_a_id INTEGER NOT NULL REFERENCES branches_master(id) ON DELETE RESTRICT,
  branch_b_id INTEGER NOT NULL REFERENCES branches_master(id) ON DELETE RESTRICT,
  relation_type TEXT NOT NULL
    CHECK (relation_type IN ('육합','삼합','방합','충','형','파','해','원진')),
  UNIQUE (branch_a_id, branch_b_id, relation_type),
  CHECK (branch_a_id <> branch_b_id)
);

-- 천간 관계 (합/극) — 단방향 저장
CREATE TABLE IF NOT EXISTS stem_relations (
  id SERIAL PRIMARY KEY,
  stem_a_id INTEGER NOT NULL REFERENCES stems_master(id) ON DELETE RESTRICT,
  stem_b_id INTEGER NOT NULL REFERENCES stems_master(id) ON DELETE RESTRICT,
  relation_type TEXT NOT NULL
    CHECK (relation_type IN ('합','극')),
  UNIQUE (stem_a_id, stem_b_id, relation_type),
  CHECK (stem_a_id <> stem_b_id)
);

CREATE INDEX IF NOT EXISTS idx_sipsin_dm_target ON sipsin_lookup(day_master_stem_id, target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_sibiunsung_dm_branch ON sibiunsung_lookup(day_master_stem_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_branch_relations_a ON branch_relations(branch_a_id);
CREATE INDEX IF NOT EXISTS idx_branch_relations_b ON branch_relations(branch_b_id);
