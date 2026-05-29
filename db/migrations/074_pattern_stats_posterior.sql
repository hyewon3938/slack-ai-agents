-- 074: pattern_stats 가설 단위 Bayesian posterior 추가
-- 마스터 #434 Phase 7. ADR-0024 실행.
--
-- Phase 4(065)가 pattern_metrics에 매트릭 단위 posterior를 도입했고,
-- 본 마이그레이션은 가설 단위(seed × enum_target) posterior를 pattern_stats에 추가한다.
-- weekly-hypothesis-review cron이 stats UPSERT 시 누적 hit/miss로부터
-- posterior_alpha/beta 재계산 (pattern_metrics와 동일하게 prior Beta(1,1)).
--
-- backfill 정책: 기존 row(Phase 4 이후 1주분만 누적)는 NULL 유지.
-- 다음 weekly-hypothesis-review cron이 채움 — 1주 대기로 backfill SQL 생략.

BEGIN;

ALTER TABLE pattern_stats
  ADD COLUMN IF NOT EXISTS posterior_alpha NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS posterior_beta  NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS posterior_p     NUMERIC(6,4);

COMMENT ON COLUMN pattern_stats.posterior_alpha IS
  '가설 단위 Beta-Binomial α (prior Beta(1,1) + 누적 hit). ADR-0024.';
COMMENT ON COLUMN pattern_stats.posterior_beta IS
  '가설 단위 Beta-Binomial β (prior Beta(1,1) + 누적 miss). ADR-0024.';
COMMENT ON COLUMN pattern_stats.posterior_p IS
  '사후 평균 = α / (α + β). NULL이면 아직 누적 갱신 전.';

COMMIT;
