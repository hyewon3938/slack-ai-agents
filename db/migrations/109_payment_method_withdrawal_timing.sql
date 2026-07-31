-- 109: 결제수단별 자금 반영 시점 정합화 (#615, ADR 0062)
-- 자금 기준일: 이 잔액이 며칠까지의 입출금을 반영한 값인가
ALTER TABLE assets ADD COLUMN IF NOT EXISTS balance_as_of DATE;

-- 백필: 마지막 갱신 시각(KST 날짜)이 곧 그 잔액의 기준일
UPDATE assets
SET balance_as_of = (updated_at AT TIME ZONE 'Asia/Seoul')::date
WHERE balance_as_of IS NULL;

-- 고정비 결제수단: 자동 기록이 하드코딩 대신 이 값을 쓴다.
-- 백필하지 않는다 — 읽는 쪽이 기본값으로 폴백하므로 결과가 같고,
-- 스키마에 특정 수단명을 굽지 않는다.
ALTER TABLE fixed_costs ADD COLUMN IF NOT EXISTS payment_method TEXT;
