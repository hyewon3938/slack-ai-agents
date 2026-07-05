-- 103: 일운 콜 장부 (fortune_calls, #582, ADR-0057)
-- period_forecasts(절기 기간 × 신호 pass율, 무인 통계 채점 — 091)와 역할 분리.
-- 서술형·이벤트성 예측을 반증 가능한 콜(claim + criterion)로 명시 등록하고,
-- scope_end 경과 후 판정한다(적중/부분/불발/측정불가). 확률 점수(Brier 등) 없음 — 091과 동일 철학.
-- 등록·채점은 DB 프록시를 쓰는 주간 routine 경로 — 봇 코드는 이 테이블을 소비하지 않는다.

CREATE TABLE fortune_calls (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_start  DATE NOT NULL,
  scope_end    DATE NOT NULL,
  claim        TEXT NOT NULL,
  criterion    TEXT NOT NULL,
  source       TEXT NOT NULL DEFAULT 'weekly' CHECK (source IN ('weekly', 'report', 'manual')),
  status       TEXT NOT NULL DEFAULT 'open'
               CHECK (status IN ('open', 'hit', 'partial', 'miss', 'unmeasurable')),
  verdict_note TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scored_at    TIMESTAMPTZ,
  CONSTRAINT fortune_calls_scope CHECK (scope_end >= scope_start),
  CONSTRAINT fortune_calls_scored_state CHECK (
    (status = 'open' AND scored_at IS NULL) OR (status <> 'open' AND scored_at IS NOT NULL)
  )
);

CREATE INDEX idx_fortune_calls_due ON fortune_calls (user_id, scope_end) WHERE status = 'open';

COMMENT ON TABLE fortune_calls IS
  '반증 가능 일운·이벤트 콜 장부 (#582, ADR-0057). 등록: 주간 일운 routine(주 2~3개 상한) 또는 수동(source=manual)·리포트 시드(source=report). 채점: scope_end 경과 후 criterion 기준 3단 판정(hit/partial/miss)+unmeasurable — 통계 채점 아님(period_forecasts와 분리).';
