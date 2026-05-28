import { describe, expect, it } from 'vitest';

import type { CalendarEventAux, DailyContext } from '../../pattern-match.js';
import { evaluateCalendarEvent } from '../calendar-event.js';

const baseCtx = (date: string): DailyContext => ({ date, userId: 1 }) as unknown as DailyContext;

describe('evaluateCalendarEvent - holiday', () => {
  it('신정(2026-01-01)은 공휴일', async () => {
    const aux: CalendarEventAux = { kind: 'calendar_event', event: 'holiday' };
    expect(await evaluateCalendarEvent(aux, baseCtx('2026-01-01'))).toBe(true);
  });

  it('설날(2026-02-17)은 공휴일', async () => {
    const aux: CalendarEventAux = { kind: 'calendar_event', event: 'holiday' };
    expect(await evaluateCalendarEvent(aux, baseCtx('2026-02-17'))).toBe(true);
  });

  it('평일은 false', async () => {
    const aux: CalendarEventAux = { kind: 'calendar_event', event: 'holiday' };
    expect(await evaluateCalendarEvent(aux, baseCtx('2026-06-15'))).toBe(false);
  });
});

describe('evaluateCalendarEvent - holiday_next', () => {
  it('신정 다음날(2026-01-02)은 holiday_next true', async () => {
    const aux: CalendarEventAux = { kind: 'calendar_event', event: 'holiday_next' };
    expect(await evaluateCalendarEvent(aux, baseCtx('2026-01-02'))).toBe(true);
  });

  it('설날 연휴 다음날(2026-02-19)은 holiday_next true', async () => {
    const aux: CalendarEventAux = { kind: 'calendar_event', event: 'holiday_next' };
    // 2026-02-18 = 설날 연휴 마지막 → 2026-02-19 = next
    expect(await evaluateCalendarEvent(aux, baseCtx('2026-02-19'))).toBe(true);
  });

  it('평일은 holiday_next false', async () => {
    const aux: CalendarEventAux = { kind: 'calendar_event', event: 'holiday_next' };
    expect(await evaluateCalendarEvent(aux, baseCtx('2026-06-15'))).toBe(false);
  });
});

describe('evaluateCalendarEvent - autopay_day', () => {
  it('day_of_month 일치 시 true', async () => {
    const aux: CalendarEventAux = {
      kind: 'calendar_event',
      event: 'autopay_day',
      day_of_month: 15,
    };
    expect(await evaluateCalendarEvent(aux, baseCtx('2026-06-15'))).toBe(true);
  });

  it('day_of_month 불일치 시 false', async () => {
    const aux: CalendarEventAux = {
      kind: 'calendar_event',
      event: 'autopay_day',
      day_of_month: 15,
    };
    expect(await evaluateCalendarEvent(aux, baseCtx('2026-06-16'))).toBe(false);
  });

  it('day_of_month 미지정 시 false', async () => {
    const aux: CalendarEventAux = { kind: 'calendar_event', event: 'autopay_day' };
    expect(await evaluateCalendarEvent(aux, baseCtx('2026-06-15'))).toBe(false);
  });
});
