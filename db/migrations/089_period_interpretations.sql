-- 089: 기간 해석 저장 — period_interpretations (#529 / #523 Phase 2, ADR-0050)
-- 월운/세운/대운 해석을 절기 전환·입춘·대운 전환 시 cron이 생성·동결한다.
-- fast path 정확일치 조회(^월운$/^세운$/^대운$)가 최신 행을 LLM 없이 렌더.
--
-- 소유권 분리: fortune_analyses(외부 weekly-fortune routine 소유, 교과서 레이어)와 별개.
-- period_interpretations는 saju_response_profile(측정) + 만세력(결정론)에서 재생성 가능한 파생 성격.
-- 검증가능성 사다리(ADR-0050): 월운=축적-실증 / 세운=장부한정 약실증 / 대운=비실증 추론.
-- 전이 가설(일 단위 반응→상위 단위)은 미검증 가정 — narrative가 라벨로 동반.

CREATE TABLE IF NOT EXISTS period_interpretations (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_type   TEXT NOT NULL,    -- 'wolun'(월운) | 'seun'(세운) | 'daeun'(대운)
  period_start  DATE NOT NULL,    -- 절기월 시작일 / 입춘일 / 대운 전환 감지일
  period_end    DATE,             -- 절기월 끝(다음 절기 전날) / 입춘년 끝 / 대운은 NULL
  pillar        TEXT NOT NULL,    -- 기간 간지 한글 2자 (예: 병인)
  structured    JSONB NOT NULL,   -- { measuredCells, textbookCells, descriptiveStats }
  narrative     TEXT NOT NULL,    -- LLM 서사 (생성 시점 동결, fast path는 이걸 렌더)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_type IN ('wolun', 'seun', 'daeun')),
  UNIQUE (user_id, period_type, period_start)
);

COMMENT ON TABLE period_interpretations IS
  '기간(월운/세운/대운) 해석 — 절기 전환·입춘·대운 전환 시 cron 생성·동결. fast path 정확일치 조회가 최신 행(period_type별 ORDER BY period_start DESC, created_at DESC LIMIT 1) 렌더. 파생 성격(structured는 saju_response_profile+만세력에서 재생성 가능). #523 Phase 2, ADR-0050.';

-- UNIQUE(user_id, period_type, period_start) btree가 fast path 최신행 조회(user+type, period_start 정렬)
-- 와 cron UPSERT(같은 전환일 중복 차단) 모두 커버 → 별도 인덱스 불요.

DO $$
DECLARE
  has_table INT;
BEGIN
  SELECT count(*) INTO has_table FROM information_schema.tables
   WHERE table_name = 'period_interpretations';
  IF has_table <> 1 THEN
    RAISE EXCEPTION '[089] period_interpretations 테이블 생성 실패';
  END IF;
  RAISE NOTICE '[089] period_interpretations 테이블 생성 OK';
END $$;
