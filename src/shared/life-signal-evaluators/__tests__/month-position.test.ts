import { describe, expect, it } from 'vitest';

import type { DailyContext, MonthPositionAux } from '../../pattern-match.js';
import { evaluateMonthPosition } from '../month-position.js';

const baseCtx = (date: string): DailyContext => ({ date, userId: 1 }) as unknown as DailyContext;

describe('evaluateMonthPosition - start', () => {
  it('월초 1~3일은 true (range_days=3 기본)', async () => {
    const aux: MonthPositionAux = { kind: 'month_position', position: 'start', range_days: 3 };
    expect(await evaluateMonthPosition(aux, baseCtx('2026-06-01'))).toBe(true);
    expect(await evaluateMonthPosition(aux, baseCtx('2026-06-03'))).toBe(true);
  });

  it('월초 4일은 false', async () => {
    const aux: MonthPositionAux = { kind: 'month_position', position: 'start', range_days: 3 };
    expect(await evaluateMonthPosition(aux, baseCtx('2026-06-04'))).toBe(false);
  });
});

describe('evaluateMonthPosition - end', () => {
  it('월말 28~30일은 6월(말일 30)에 true', async () => {
    const aux: MonthPositionAux = { kind: 'month_position', position: 'end', range_days: 3 };
    expect(await evaluateMonthPosition(aux, baseCtx('2026-06-28'))).toBe(true);
    expect(await evaluateMonthPosition(aux, baseCtx('2026-06-30'))).toBe(true);
  });

  it('월말 27일은 6월에 false', async () => {
    const aux: MonthPositionAux = { kind: 'month_position', position: 'end', range_days: 3 };
    expect(await evaluateMonthPosition(aux, baseCtx('2026-06-27'))).toBe(false);
  });

  it('2월 말일 (28일) 경계 검증', async () => {
    const aux: MonthPositionAux = { kind: 'month_position', position: 'end', range_days: 3 };
    // 2026-02 (평년) 말일 = 28
    expect(await evaluateMonthPosition(aux, baseCtx('2026-02-26'))).toBe(true);
    expect(await evaluateMonthPosition(aux, baseCtx('2026-02-28'))).toBe(true);
    expect(await evaluateMonthPosition(aux, baseCtx('2026-02-25'))).toBe(false);
  });
});

describe('evaluateMonthPosition - mid', () => {
  it('월중 11~20일은 true', async () => {
    const aux: MonthPositionAux = { kind: 'month_position', position: 'mid', start: 11, end: 20 };
    expect(await evaluateMonthPosition(aux, baseCtx('2026-06-11'))).toBe(true);
    expect(await evaluateMonthPosition(aux, baseCtx('2026-06-15'))).toBe(true);
    expect(await evaluateMonthPosition(aux, baseCtx('2026-06-20'))).toBe(true);
  });

  it('월중 10일과 21일은 false', async () => {
    const aux: MonthPositionAux = { kind: 'month_position', position: 'mid', start: 11, end: 20 };
    expect(await evaluateMonthPosition(aux, baseCtx('2026-06-10'))).toBe(false);
    expect(await evaluateMonthPosition(aux, baseCtx('2026-06-21'))).toBe(false);
  });
});
