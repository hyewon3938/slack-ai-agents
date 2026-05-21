-- 할부 자산 차감 범위 토글 — distribute_to_runway 컬럼 추가
--
-- ADR 0018: 사용자가 명시적으로 OFF한 할부는 target_date 이내 회차만 INSERT 시 자산 차감.
-- target_date 이후 회차는 자산 무영향 → 결제주기 종료 cron에서 자유지출로 처리.
--
-- 기본값 true로 backfill되어 ADR 0015 동작은 그대로 유지 (default = 즉시 전체 차감).

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS distribute_to_runway BOOLEAN NOT NULL DEFAULT true;
