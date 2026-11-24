/** 예측 장부 — fast path 카드용 장부 로드. */

import { query } from '../db.js';
import type { LedgerPeriodType, LedgerCardData } from './types.js';
import {
  type ForecastDbRow,
  toForecastEntry,
  toScoredEntry,
  FORECAST_COLUMNS,
} from './forecast-rows.js';

// ─── 로드 (fast path) ─────────────────────────────────────

/** 상태 집합 중 최신 period_start의 행. */
const loadLatestEntries = async (
  userId: number,
  periodType: LedgerPeriodType,
  statuses: ReadonlyArray<string>,
): Promise<ForecastDbRow[]> => {
  const res = await query<ForecastDbRow>(
    `SELECT ${FORECAST_COLUMNS}
       FROM period_forecasts
      WHERE user_id = $1 AND period_type = $2 AND status = ANY($3::text[])
        AND period_start = (
          SELECT MAX(period_start) FROM period_forecasts
           WHERE user_id = $1 AND period_type = $2 AND status = ANY($3::text[]))
      ORDER BY id`,
    [userId, periodType, [...statuses]],
  );
  return res.rows;
};

/** 최신 기간 예측(open+no_call) + 직전 채점(scored+unmeasurable) — fast path 카드용. */
export const loadLedger = async (
  userId: number,
  periodType: LedgerPeriodType,
): Promise<LedgerCardData> => {
  const [forecastRows, scoredRows] = await Promise.all([
    loadLatestEntries(userId, periodType, ['open', 'no_call']),
    loadLatestEntries(userId, periodType, ['scored', 'unmeasurable']),
  ]);
  return {
    periodType,
    forecasts: forecastRows.map(toForecastEntry),
    scored: scoredRows.map(toScoredEntry),
  };
};
