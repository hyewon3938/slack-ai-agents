import { describe, it, expect } from 'vitest';
import {
  parseSourceCell,
  toForecastEntry,
  toScoredEntry,
  type ForecastDbRow,
} from '../period/forecast-rows.js';

const SOURCE_CELL = {
  domain: 'sleep',
  via: 'stem',
  resolvedLevel: 'char_stem',
  axisKey: '병',
  tier: 'emerging',
  shrunkEffect: 0.12,
  signalId: 41,
};

const row = (over: Partial<ForecastDbRow>): ForecastDbRow => ({
  signal_id: 41,
  status: 'open',
  predicted_direction: 'up',
  baseline_rate: 0.5,
  source_cell: SOURCE_CELL,
  measured_rate: null,
  measured_delta: null,
  direction_hit: null,
  ...over,
});

// ─── parseSourceCell ────────────────────────────────────

describe('parseSourceCell', () => {
  it('객체는 그대로 돌려준다', () => {
    expect(parseSourceCell(SOURCE_CELL)).toEqual(SOURCE_CELL);
    expect(parseSourceCell({ reason: '측정 셀 없음' })).toEqual({ reason: '측정 셀 없음' });
  });

  it('null·undefined는 근거 미상 사유로 바꾼다', () => {
    expect(parseSourceCell(null)).toEqual({ reason: '근거 미상' });
    expect(parseSourceCell(undefined)).toEqual({ reason: '근거 미상' });
  });

  it('객체가 아닌 값(문자열·숫자)도 근거 미상 사유로 바꾼다', () => {
    expect(parseSourceCell('{"reason":"x"}')).toEqual({ reason: '근거 미상' });
    expect(parseSourceCell(3)).toEqual({ reason: '근거 미상' });
  });
});

// ─── toForecastEntry ────────────────────────────────────

describe('toForecastEntry', () => {
  it('open 행을 엔트리로 변환한다', () => {
    expect(toForecastEntry(row({}))).toEqual({
      signalId: 41,
      status: 'open',
      predictedDirection: 'up',
      baselineRate: 0.5,
      sourceCell: SOURCE_CELL,
    });
  });

  it('no_call 행은 status를 유지하고 신호·방향이 null이어도 그대로 둔다', () => {
    const e = toForecastEntry(
      row({
        signal_id: null,
        status: 'no_call',
        predicted_direction: null,
        baseline_rate: null,
        source_cell: { reason: '측정 셀 없음' },
      }),
    );
    expect(e).toEqual({
      signalId: null,
      status: 'no_call',
      predictedDirection: null,
      baselineRate: null,
      sourceCell: { reason: '측정 셀 없음' },
    });
  });

  it('pg NUMERIC 문자열 baseline_rate를 숫자로 바꾼다', () => {
    const e = toForecastEntry(row({ baseline_rate: '0.375' as unknown as number }));
    expect(e.baselineRate).toBe(0.375);
  });

  it('알 수 없는 방향 문자열은 null', () => {
    expect(toForecastEntry(row({ predicted_direction: 'sideways' })).predictedDirection).toBeNull();
    expect(toForecastEntry(row({ predicted_direction: 'down' })).predictedDirection).toBe('down');
  });

  it('no_call이 아닌 status는 전부 open으로 본다', () => {
    expect(toForecastEntry(row({ status: 'scored' })).status).toBe('open');
  });
});

// ─── toScoredEntry ──────────────────────────────────────

describe('toScoredEntry', () => {
  it('scored 행의 측정값·적중 여부를 숫자/불리언으로 옮긴다', () => {
    const e = toScoredEntry(
      row({
        status: 'scored',
        baseline_rate: '0.4' as unknown as number,
        measured_rate: '0.65' as unknown as number,
        measured_delta: '0.25' as unknown as number,
        direction_hit: true,
      }),
    );
    expect(e).toEqual({
      signalId: 41,
      status: 'scored',
      predictedDirection: 'up',
      baselineRate: 0.4,
      measuredRate: 0.65,
      measuredDelta: 0.25,
      directionHit: true,
      sourceCell: SOURCE_CELL,
    });
  });

  it('unmeasurable 행은 측정값이 null이어도 NaN이 아닌 null로 남긴다', () => {
    const e = toScoredEntry(
      row({ status: 'unmeasurable', measured_rate: null, measured_delta: null }),
    );
    expect(e.status).toBe('unmeasurable');
    expect(e.measuredRate).toBeNull();
    expect(e.measuredDelta).toBeNull();
    expect(e.directionHit).toBeNull();
  });

  it('measured_delta 0은 null이 아닌 0으로 남긴다 (falsy 처리 회귀 방지)', () => {
    const e = toScoredEntry(row({ status: 'scored', measured_delta: 0, measured_rate: 0 }));
    expect(e.measuredDelta).toBe(0);
    expect(e.measuredRate).toBe(0);
  });

  it('unmeasurable이 아닌 status는 전부 scored로 본다', () => {
    expect(toScoredEntry(row({ status: 'open' })).status).toBe('scored');
  });
});
