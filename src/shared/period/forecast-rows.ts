/** 예측 장부 — DB 행과 엔트리 변환, 기간별 예측 행 로드. */

import { query } from '../db.js';
import type {
  LedgerPeriodType,
  ForecastSourceCell,
  NoCallReason,
  ForecastEntry,
  ScoredEntry,
} from './types.js';

// ─── DB 행 ↔ 엔트리 ───────────────────────────────────────

export interface ForecastDbRow {
  signal_id: number | null;
  status: string;
  predicted_direction: string | null;
  baseline_rate: number | null;
  source_cell: unknown;
  measured_rate: number | null;
  measured_delta: number | null;
  direction_hit: boolean | null;
}

export const parseDirection = (s: string | null): 'up' | 'down' | null =>
  s === 'up' || s === 'down' ? s : null;

export const parseSourceCell = (raw: unknown): ForecastSourceCell | NoCallReason => {
  if (typeof raw !== 'object' || raw === null) return { reason: '근거 미상' };
  return raw as ForecastSourceCell | NoCallReason;
};

export const toForecastEntry = (row: ForecastDbRow): ForecastEntry => ({
  signalId: row.signal_id,
  status: row.status === 'no_call' ? 'no_call' : 'open',
  predictedDirection: parseDirection(row.predicted_direction),
  baselineRate: row.baseline_rate === null ? null : Number(row.baseline_rate),
  sourceCell: parseSourceCell(row.source_cell),
});

export const toScoredEntry = (row: ForecastDbRow): ScoredEntry => ({
  signalId: row.signal_id,
  status: row.status === 'unmeasurable' ? 'unmeasurable' : 'scored',
  predictedDirection: parseDirection(row.predicted_direction),
  baselineRate: row.baseline_rate === null ? null : Number(row.baseline_rate),
  measuredRate: row.measured_rate === null ? null : Number(row.measured_rate),
  measuredDelta: row.measured_delta === null ? null : Number(row.measured_delta),
  directionHit: row.direction_hit,
  sourceCell: parseSourceCell(row.source_cell) as ForecastSourceCell,
});

export const FORECAST_COLUMNS = `signal_id, status, predicted_direction, baseline_rate, source_cell,
            measured_rate, measured_delta, direction_hit`;

/** 특정 (user, type, start)의 예측 행 로드 (멱등 가드용). */
export const loadForecastsForPeriod = async (
  userId: number,
  periodType: LedgerPeriodType,
  periodStart: string,
): Promise<ForecastEntry[]> => {
  const res = await query<ForecastDbRow>(
    `SELECT ${FORECAST_COLUMNS}
       FROM period_forecasts
      WHERE user_id = $1 AND period_type = $2 AND period_start = $3
        AND status IN ('open', 'no_call')
      ORDER BY id`,
    [userId, periodType, periodStart],
  );
  return res.rows.map(toForecastEntry);
};
