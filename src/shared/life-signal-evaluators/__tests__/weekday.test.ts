import { describe, expect, it } from 'vitest';

import type { DailyContext, WeekdayAux, WeekdayGroupAux } from '../../saju-match.js';
import { evaluateWeekday, evaluateWeekdayGroup } from '../weekday.js';

const baseCtx = (date: string): DailyContext =>
  ({
    date,
    userId: 1,
  }) as unknown as DailyContext; // weekday evaluator는 date/userId만 사용

describe('evaluateWeekday', () => {
  // 2026-06-01 = 월요일 (Mon), 2026-06-07 = 일요일 (Sun)
  it('월요일 시드(dow=1)는 월요일에 true', async () => {
    const aux: WeekdayAux = { kind: 'weekday', dow: 1 };
    expect(await evaluateWeekday(aux, baseCtx('2026-06-01'))).toBe(true);
  });

  it('월요일 시드(dow=1)는 화요일에 false', async () => {
    const aux: WeekdayAux = { kind: 'weekday', dow: 1 };
    expect(await evaluateWeekday(aux, baseCtx('2026-06-02'))).toBe(false);
  });

  it('일요일 시드(dow=0)는 일요일에 true', async () => {
    const aux: WeekdayAux = { kind: 'weekday', dow: 0 };
    expect(await evaluateWeekday(aux, baseCtx('2026-06-07'))).toBe(true);
  });

  it('금요일 시드(dow=5)는 금요일에 true', async () => {
    const aux: WeekdayAux = { kind: 'weekday', dow: 5 };
    expect(await evaluateWeekday(aux, baseCtx('2026-06-05'))).toBe(true);
  });
});

describe('evaluateWeekdayGroup', () => {
  it('weekend 그룹은 토요일에 true', async () => {
    const aux: WeekdayGroupAux = { kind: 'weekday_group', group: 'weekend' };
    expect(await evaluateWeekdayGroup(aux, baseCtx('2026-06-06'))).toBe(true); // 토
  });

  it('weekend 그룹은 일요일에 true', async () => {
    const aux: WeekdayGroupAux = { kind: 'weekday_group', group: 'weekend' };
    expect(await evaluateWeekdayGroup(aux, baseCtx('2026-06-07'))).toBe(true); // 일
  });

  it('weekend 그룹은 평일에 false', async () => {
    const aux: WeekdayGroupAux = { kind: 'weekday_group', group: 'weekend' };
    expect(await evaluateWeekdayGroup(aux, baseCtx('2026-06-03'))).toBe(false); // 수
  });

  it('weekday 그룹은 월~금에 true', async () => {
    const aux: WeekdayGroupAux = { kind: 'weekday_group', group: 'weekday' };
    expect(await evaluateWeekdayGroup(aux, baseCtx('2026-06-01'))).toBe(true); // 월
    expect(await evaluateWeekdayGroup(aux, baseCtx('2026-06-05'))).toBe(true); // 금
  });

  it('weekday 그룹은 주말에 false', async () => {
    const aux: WeekdayGroupAux = { kind: 'weekday_group', group: 'weekday' };
    expect(await evaluateWeekdayGroup(aux, baseCtx('2026-06-06'))).toBe(false); // 토
  });
});
