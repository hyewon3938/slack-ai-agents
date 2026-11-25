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

const UNKNOWN_SOURCE: NoCallReason = { reason: '근거 미상' };

/**
 * source_cell JSONB → 셀 또는 근거 없음 사유. 카드가 읽는 필드(사유 문자열, 또는 domain·axisKey)가
 * 없으면 셀로 넘기지 않고 '근거 미상'으로 바꾼다(null 행·손상 행이 셀처럼 렌더되는 것 방지).
 */
export const parseSourceCell = (raw: unknown): ForecastSourceCell | NoCallReason => {
  if (typeof raw !== 'object' || raw === null) return { ...UNKNOWN_SOURCE };
  const obj = raw as Record<string, unknown>;
  if (typeof obj.reason === 'string') return raw as NoCallReason;
  if (typeof obj.domain === 'string' && typeof obj.axisKey === 'string') {
    return raw as ForecastSourceCell;
  }
  return { ...UNKNOWN_SOURCE };
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
  sourceCell: parseSourceCell(row.source_cell),
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
