/** 예측 장부 — 기간 종료 뒤 사후 채점. */

import { query } from '../db.js';
import { addDays } from '../kst.js';
import { computeSignalSeries } from '../pattern/series.js';
import { computeUserDataStarts, signalDataStart } from '../pattern/data-window.js';
import { loadSignalDefsByIds } from '../pattern/load-signal-defs.js';
import { INSIGHT_THRESHOLDS } from '../insight-thresholds.js';
import type { LedgerPeriodType, ForecastSourceCell, ScoredEntry } from './types.js';
import { parseDirection, parseSourceCell } from './forecast-rows.js';

const PF = INSIGHT_THRESHOLDS.periodForecast;

/** 기간 일자 enumerate (start~end 포함). buildWindowDates는 today-anchored라 부적합 → 로컬. */
const enumerateDates = (start: string, end: string): string[] => {
  const out: string[] = [];
  let d = start;
  while (d <= end) {
    out.push(d);
    d = addDays(d, 1);
  }
  return out;
};

// ─── 채점 (사후) ──────────────────────────────────────────

interface OpenForecastRow {
  id: number;
  period_start: string;
  period_end: string;
  signal_id: number | null;
  predicted_direction: string | null;
  baseline_rate: number | null;
  source_cell: unknown;
}

/**
 * 직전 기간 open 예측 채점 — self-heal(period_end <= today, == 아님)로 놓친 전환 자동 회수.
 * 신호 시리즈를 기간 한정 집계 → measured_rate/delta/방향적중. 측정가능일 부족 시 unmeasurable(강제판정 금지).
 * baseline_rate는 절대 재계산 안 함(동결 불변식). UPDATE는 status='open' 가드(멱등).
 */
export const scoreForecasts = async (
  userId: number,
  periodType: LedgerPeriodType,
  today: string,
): Promise<ScoredEntry[]> => {
  const openRes = await query<OpenForecastRow>(
    `SELECT id, period_start::text, period_end::text, signal_id,
            predicted_direction, baseline_rate, source_cell
       FROM period_forecasts
      WHERE user_id = $1 AND period_type = $2 AND status = 'open' AND period_end <= $3
      ORDER BY id`,
    [userId, periodType, today],
  );
  if (openRes.rows.length === 0) return [];

  const signalIds = [
    ...new Set(openRes.rows.map((r) => r.signal_id).filter((v): v is number => v !== null)),
  ];
  const signalById = await loadSignalDefsByIds(signalIds);
  const dataStarts = await computeUserDataStarts(userId);

  const out: ScoredEntry[] = [];
  for (const row of openRes.rows) {
    const baseline = row.baseline_rate === null ? null : Number(row.baseline_rate);
    const direction = parseDirection(row.predicted_direction);
    const sourceCell = parseSourceCell(row.source_cell) as ForecastSourceCell;
    const signal = row.signal_id !== null ? signalById.get(row.signal_id) : undefined;

    // 신호 결측/비활성 또는 baseline 없음 → 측정 불가(강제판정 금지).
    if (!signal || baseline === null || direction === null) {
      await markUnmeasurable(row.id);
      out.push(unmeasurableEntry(row.signal_id, direction, baseline, sourceCell));
      continue;
    }

    const windowDates = enumerateDates(
      addDays(row.period_start, -PF.baselineLeadInDays),
      row.period_end,
    );
    const dataStart = signalDataStart(signal.domain, dataStarts);
    const { series } = await computeSignalSeries(userId, signal, windowDates, dataStart);

    // 기간 한정 집계: period_start ≤ d ≤ period_end인 날만(lead-in은 baseline 워밍업 전용).
    let measurable = 0;
    let pass = 0;
    for (let d = row.period_start; d <= row.period_end; d = addDays(d, 1)) {
      const v = series.get(d);
      if (v === null || v === undefined) continue; // 측정불가일
      measurable += 1;
      if (v === true) pass += 1;
    }

    if (measurable < PF.minMeasurableDays) {
      await markUnmeasurable(row.id);
      out.push(unmeasurableEntry(row.signal_id, direction, baseline, sourceCell));
      continue;
    }

    const measuredRate = pass / measurable;
    const measuredDelta = measuredRate - baseline;
    const directionHit = direction === 'up' ? measuredRate > baseline : measuredRate < baseline; // 동률=미적중
    await query(
      `UPDATE period_forecasts
          SET status = 'scored', measured_rate = $2, measured_delta = $3,
              direction_hit = $4, scored_at = NOW()
        WHERE id = $1 AND status = 'open'`,
      [row.id, measuredRate, measuredDelta, directionHit],
    );
    out.push({
      signalId: row.signal_id,
      status: 'scored',
      predictedDirection: direction,
      baselineRate: baseline,
      measuredRate,
      measuredDelta,
      directionHit,
      sourceCell,
    });
  }
  return out;
};

const markUnmeasurable = async (id: number): Promise<void> => {
  await query(
    `UPDATE period_forecasts SET status = 'unmeasurable', scored_at = NOW()
      WHERE id = $1 AND status = 'open'`,
    [id],
  );
};

const unmeasurableEntry = (
  signalId: number | null,
  direction: 'up' | 'down' | null,
  baseline: number | null,
  sourceCell: ForecastSourceCell,
): ScoredEntry => ({
  signalId,
  status: 'unmeasurable',
  predictedDirection: direction,
  baselineRate: baseline,
  measuredRate: null,
  measuredDelta: null,
  directionHit: null,
  sourceCell,
});
