-- expenses에 billing_month 컬럼 추가
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS billing_month VARCHAR(7);

-- backfill: 기존 데이터는 시스템 대금기간(14~13) 기준으로 계산
-- day >= 14면 다음 달, day < 14면 현재 달
UPDATE expenses
SET billing_month = CASE
  WHEN EXTRACT(DAY FROM date) >= 14
  THEN TO_CHAR(date + INTERVAL '1 month', 'YYYY-MM')
  ELSE TO_CHAR(date, 'YYYY-MM')
END
WHERE billing_month IS NULL;
